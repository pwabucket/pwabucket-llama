/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

function getRootDomain(url: string): string | null {
	try {
		const urlObject = new URL(url);
		let hostname = urlObject.hostname;

		if (hostname.startsWith('www.')) {
			hostname = hostname.substring(4);
		}

		const parts = hostname.split('.');

		if (parts.length > 2) {
			const lastPart = parts[parts.length - 1];
			if (lastPart.length <= 3 && parts[parts.length - 2].length <= 3) {
				return parts.slice(-3).join('.');
			} else {
				return parts.slice(-2).join('.');
			}
		} else {
			return hostname;
		}
	} catch (error) {
		return null;
	}
}

function isValidURL(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch (error) {
		return false;
	}
}
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		const allowedDomains = env.ALLOWED_DOMAINS ? env.ALLOWED_DOMAINS.split(',').map((domain) => domain.trim()) : [];
		const requestOrigin = request.headers.get('Origin');
		const rootDomain = getRootDomain(requestOrigin || '');

		if (!rootDomain || !allowedDomains.includes(rootDomain)) {
			return new Response('Forbidden: Origin not allowed', { status: 403 });
		}

		const forwardedURL = url.searchParams.get('url');
		if (!forwardedURL) {
			return new Response('Bad Request: Missing url parameter', { status: 400 });
		} else if (!isValidURL(forwardedURL)) {
			return new Response('Bad Request: Invalid url parameter', { status: 400 });
		}

		/* Create a new request to the forwarded URL */
		const originRequest = new Request(forwardedURL, request);

		/* Set the Origin header to match the forwarded URL's origin */
		originRequest.headers.set('Origin', new URL(forwardedURL).origin);

		/* Transfer custom headers prefixed with 'x-llama-' to the origin request */
		for (const [key, value] of request.headers) {
			if (key.startsWith('x-llama-')) {
				const target = key.replace('x-llama-', '');
				originRequest.headers.set(target, value);
				originRequest.headers.delete(key);
			}
		}

		const response = await fetch(originRequest);

		response.headers.set('Access-Control-Allow-Origin', requestOrigin || '*');
		response.headers.set('Access-Control-Allow-Methods', request.method);
		response.headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || '*');

		return response;
	},
} satisfies ExportedHandler<Env>;
