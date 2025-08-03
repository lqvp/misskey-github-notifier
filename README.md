# misskey-github-notifier
GitHub notifier for Misskey, deployed on Cloudflare Workers.

## Configuration
This project is configured using Cloudflare Workers secrets.

### 1. GitHub Webhook
1. Go to your repository's **Settings** > **Webhooks** > **Add webhook**.
2. For **Payload URL**, enter the URL of your deployed Cloudflare Worker.
3. For **Content type**, select `application/json`.
4. Create a random string for the **Secret**. You will use this in the next step.
5. For **Which events would you like to trigger this webhook?**, select the events you want to receive notifications for.

### 2. Misskey Bot
1. Create a new account on a bot-friendly Misskey instance.
2. Mark the account as a bot in the profile settings.
3. Go to **Settings** > **API** and generate an API token.

### 3. Deploy to Cloudflare Workers
1. Clone this repository and navigate into the directory.
2. Install dependencies: `npm install`
3. Authenticate with Cloudflare: `npx wrangler login`
4. Set up your secrets. You will be prompted to enter the values for each secret.
   ```bash
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put MISSKEY_TOKEN
   npx wrangler secret put MISSKEY_HOST
   npx wrangler secret put MISSKEY_VISIBILITY
   ```
   - `WEBHOOK_SECRET`: The secret you created for the GitHub webhook.
   - `MISSKEY_TOKEN`: Your Misskey bot's API token.
   - `MISSKEY_HOST`: The URL of your Misskey instance (e.g., `https://misskey.io`).
   - `MISSKEY_VISIBILITY`: The visibility of the notes. Can be `public`, `home`, or `followers`.
5. Deploy the worker:
   ```bash
   npm run deploy
   ```

### Local Development
For local development, create a `.dev.vars` file in the root of the project:
```
WEBHOOK_SECRET="your_github_webhook_secret"
MISSKEY_TOKEN="your_misskey_api_token"
MISSKEY_HOST="https://your_misskey_instance"
MISSKEY_VISIBILITY="home"
```

Then, run the development server:
```bash
npm run dev
```

**Important:** Add `.dev.vars` to your `.gitignore` file to avoid committing your secrets.
