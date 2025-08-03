import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { EventPayloadMap } from "@octokit/webhooks/dist-types/generated/webhook-identifiers";

type Env = {
	WEBHOOK_SECRET: string;
	MISSKEY_HOST: string;
	MISSKEY_TOKEN: string;
	MISSKEY_VISIBILITY: "home" | "public" | "followers";
};

class WebhookEventEmitter extends EventEmitter {
	on<T extends keyof EventPayloadMap>(
		event: T,
		listener: (payload: EventPayloadMap[T], env: Env) => void,
	): this;
	// biome-ignore lint/suspicious/noExplicitAny: This is required to override the EventEmitter's on method.
	on(event: string | symbol, listener: (payload: any, env: Env) => void): this {
		return super.on(event, listener);
	}
}

const handler = new WebhookEventEmitter();

const post = async (text: string, env: Env) => {
	const instance = env.MISSKEY_HOST.endsWith("/")
		? env.MISSKEY_HOST.substring(0, env.MISSKEY_HOST.length - 1)
		: env.MISSKEY_HOST;

	await fetch(`${instance}/api/notes/create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			i: env.MISSKEY_TOKEN,
			text,
			visibility: env.MISSKEY_VISIBILITY,
			noExtractMentions: true,
			noExtractHashtags: true,
		}),
	});
};

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Not Found", { status: 404 });
		}

		if (request.headers.get("x-github-event") === "ping") {
			return new Response("pong", { status: 200 });
		}

		const sigHeader = request.headers.get("x-hub-signature-256");
		if (!sigHeader) {
			return new Response("Bad Request", { status: 400 });
		}

		const body = await request.text();
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(env.WEBHOOK_SECRET),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		const signature = await crypto.subtle.verify(
			"HMAC",
			key,
			hexToBuf(sigHeader.split("=")[1]),
			encoder.encode(body),
		);

		if (!signature) {
			return new Response("Forbidden", { status: 403 });
		}

		const ghHeader = request.headers.get("x-github-event") as string;
		ctx.waitUntil(
			(async () => {
				handler.emit(ghHeader, JSON.parse(body), env);
			})(),
		);

		return new Response(null, { status: 204 });
	},
};

type Status = {
	state: "error" | "failure" | "pending" | "success";
};

handler.on("status", async (event, env) => {
	const state = event.state;
	switch (state) {
		case "error":
		case "failure": {
			const commit = event.commit;
			const parent = commit.parents[0];

			// Fetch parent status
			await fetch(`${parent.url}/statuses`, {
				method: "GET",
				headers: {
					"User-Agent": "misskey-github-notifier",
				},
			})
				.then(async (res) => {
					const parentStatuses = (await res.json()) as Status[];
					const parentState = parentStatuses[0]?.state;
					const stillFailed =
						parentState === "failure" || parentState === "error";
					if (stillFailed) {
						await post(
							`⚠️ **BUILD STILL FAILED** ⚠️: ?[${commit.commit.message}](${commit.html_url})`,
							env,
						);
					} else {
						await post(
							`🚨 **BUILD FAILED** 🚨: → ?[${commit.commit.message}](${commit.html_url}) ←`,
							env,
						);
					}
				})
				.catch((err) => {
					console.error(err);
				});

			break;
		}
	}
});

handler.on("push", (event, env) => {
	const ref = event.ref;
	switch (ref) {
		case "refs/heads/develop": {
			const pusher = event.pusher;
			const compare = event.compare;
			const commits: EventPayloadMap["push"]["commits"] = event.commits;
			post(
				[
					`🆕 Pushed by **${pusher.name}** with ?[${commits.length} commit${commits.length > 1 ? "s" : ""}](${compare}):`,
					commits
						.reverse()
						.map(
							(commit) =>
								`・[?[${commit.id.substr(0, 7)}](${commit.url})] ${commit.message.split("\n")[0]}`,
						)
						.join("\n"),
				].join("\n"),
				env,
			);
			break;
		}
	}
});

handler.on("issues", (event, env) => {
	const issue = event.issue;
	let title: string;
	switch (event.action) {
		case "opened":
			title = `💥 Issue opened`;
			break;
		case "closed":
			title = `💮 Issue closed`;
			break;
		case "reopened":
			title = `🔥 Issue reopened`;
			break;
		default:
			return;
	}
	post(`${title}: #${issue.number} "${issue.title}"\n${issue.html_url}`, env);
});

handler.on("issue_comment", (event, env) => {
	const issue = event.issue;
	const comment = event.comment;
	let text: string;
	switch (event.action) {
		case "created":
			text = `💬 Commented on "${issue.title}": ${event.sender.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`;
			break;
		default:
			return;
	}
	post(text, env);
});

handler.on("release", (event, env) => {
	const release = event.release;
	let text: string;
	switch (event.action) {
		case "published":
			text = `🎁 **NEW RELEASE**: [${release.tag_name}](${release.html_url}) is out. Enjoy!`;
			break;
		default:
			return;
	}
	post(text, env);
});

handler.on("watch", (event, env) => {
	const sender = event.sender;
	post(`$[spin ⭐️] Starred by ?[**${sender.login}**](${sender.html_url})`, env);
});

handler.on("fork", (event, env) => {
	const sender = event.sender;
	const repo = event.forkee;
	post(
		`$[spin.y 🍴] ?[Forked](${repo.html_url}) by ?[**${sender.login}**](${sender.html_url})`,
		env,
	);
});

handler.on("pull_request", (event, env) => {
	const pr = event.pull_request;
	let text: string;
	switch (event.action) {
		case "opened":
			text = `📦 New Pull Request: "${pr.title}"\n${pr.html_url}`;
			break;
		case "reopened":
			text = `🗿 Pull Request Reopened: "${pr.title}"\n${pr.html_url}`;
			break;
		case "closed":
			text = pr.merged
				? `💯 Pull Request Merged!: "${pr.title}"\n${pr.html_url}`
				: `🚫 Pull Request Closed: "${pr.title}"\n${pr.html_url}`;
			break;
		case "ready_for_review":
			text = `👀 Pull Request marked as ready: "${pr.title}\n${pr.html_url}"`;
			break;
		default:
			return;
	}
	post(text, env);
});

handler.on("pull_request_review_comment", (event, env) => {
	const pr = event.pull_request;
	const comment = event.comment;
	let text: string;
	switch (event.action) {
		case "created":
			text = `💬 Review commented on "${pr.title}": ${event.sender.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`;
			break;
		default:
			return;
	}
	post(text, env);
});

handler.on("pull_request_review", (event, env) => {
	const pr = event.pull_request;
	const review = event.review;
	if (
		review.body === undefined ||
		review.body === null ||
		review.body.length <= 0
	)
		return;

	let text: string;
	switch (event.action) {
		case "submitted":
			text = `👀 Review submitted: "${pr.title}": ${event.sender.login} "<plain>${review.body}</plain>"\n${review.html_url}`;
			break;
		default:
			return;
	}
	post(text, env);
});

handler.on("discussion", (event, env) => {
	const discussion = event.discussion;
	let title: string;
	let url: string;
	switch (event.action) {
		case "created":
			title = `💭 Discussion opened`;
			url = discussion.html_url;
			break;
		case "closed":
			title = `💮 Discussion closed`;
			url = discussion.html_url;
			break;
		case "reopened":
			title = `🔥 Discussion reopened`;
			url = discussion.html_url;
			break;
		case "answered":
			title = `✅ Discussion marked answer`;
			url = event.answer.html_url;
			break;
		case "unanswered":
			title = `🔥 Discussion unmarked answer`;
			url = discussion.html_url;
			break;
		default:
			return;
	}
	post(`${title}: #${discussion.number} "${discussion.title}"\n${url}`, env);
});

handler.on("discussion_comment", (event, env) => {
	const discussion = event.discussion;
	const comment = event.comment;
	let text: string;
	switch (event.action) {
		case "created":
			text = `💬 Commented on "${discussion.title}": ${event.sender.login} "<plain>${comment.body}</plain>"\n${comment.html_url}`;
			break;
		default:
			return;
	}
	post(text, env);
});

function hexToBuf(hex: string): ArrayBuffer {
	return Buffer.from(hex, "hex").buffer;
}
