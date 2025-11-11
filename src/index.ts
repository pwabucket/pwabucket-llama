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
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch (error) {
		return false;
	}
}

/* Set CORS headers on the response */
function setCORSHeaders(response: Response, origin: string | null, request: Request): Response {
	const newHeaders = new Headers(response.headers);

	/* Delete any existing CORS headers from the proxied response */
	newHeaders.delete('Access-Control-Allow-Origin');
	newHeaders.delete('Access-Control-Allow-Methods');
	newHeaders.delete('Access-Control-Allow-Headers');
	newHeaders.delete('Access-Control-Allow-Credentials');

	/* Set our CORS headers */
	newHeaders.set('Access-Control-Allow-Origin', origin || '*');
	newHeaders.set('Access-Control-Allow-Methods', request.headers.get('Access-Control-Request-Method') || '*');
	newHeaders.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || '*');

	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});

	return newResponse;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		const allowedDomains = env.ALLOWED_DOMAINS ? env.ALLOWED_DOMAINS.split(',').map((domain) => domain.trim()) : [];
		const requestOrigin = request.headers.get('Origin');
		const rootDomain = getRootDomain(requestOrigin || '');

		if (!rootDomain || !allowedDomains.includes(rootDomain)) {
			return setCORSHeaders(new Response('Forbidden: Origin not allowed', { status: 403 }), requestOrigin, request);
		}

		const forwardedURL = url.searchParams.get('url');
		if (!forwardedURL) {
			return setCORSHeaders(new Response('Bad Request: Missing url parameter', { status: 400 }), requestOrigin, request);
		} else if (!isValidURL(forwardedURL)) {
			return setCORSHeaders(new Response('Bad Request: Invalid url parameter', { status: 400 }), requestOrigin, request);
		}

		if (request.method === 'OPTIONS') {
			return setCORSHeaders(new Response(null, { status: 204 }), requestOrigin, request);
		}

		/* Parse the forwarded URL */
		const parsedForwardedURL = new URL(forwardedURL);

		/* Create new headers for the origin request */
		const newHeaders = new Headers(request.headers);

		/* Remove existing Host, Origin and Referer headers */
		newHeaders.delete('Host');
		newHeaders.delete('Origin');
		newHeaders.delete('Referer');

		/* Set Origin, Host and Referer headers */
		newHeaders.set('Host', parsedForwardedURL.host);
		newHeaders.set('Origin', parsedForwardedURL.origin);
		newHeaders.set('Referer', parsedForwardedURL.origin + '/');

		/* Transfer custom headers prefixed with 'x-llama-' to the origin request */
		for (const [key, value] of request.headers) {
			if (key.startsWith('x-llama-')) {
				const target = key.replace('x-llama-', '');
				newHeaders.delete(key);
				newHeaders.delete(target);
				newHeaders.set(target, value);
			}
		}

		/* Create a new request to the forwarded URL with modified headers */
		const originRequest = new Request(forwardedURL, {
			method: request.method,
			headers: newHeaders,
			body: request.body,
			redirect: 'follow',
		});

		const response = await fetch(originRequest);

		/* Create new response with CORS headers */
		return setCORSHeaders(response, requestOrigin, request);
	},
} satisfies ExportedHandler<Env>;
