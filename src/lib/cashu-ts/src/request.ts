import { checkResponse } from './utils';

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;

let globalRequestOptions: Partial<RequestOptions> = {};

/**
 * An object containing any custom settings that you want to apply to the global fetch method.
 * @param options See possible options here: https://developer.mozilla.org/en-US/docs/Web/API/fetch#options
 */
export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
	globalRequestOptions = options;
}

async function _request({
	endpoint,
	requestBody,
	headers: requestHeaders,
	...options
}: RequestOptions): Promise<Response> {
	const body = requestBody ? JSON.stringify(requestBody) : undefined;
	const headers = {
		...{ Accept: 'application/json, text/plain, */*' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders
	};

	const response = await fetch(endpoint, { body, headers, ...options });

	if (!response.ok) {
		const { error, detail } = await response.json();
		const message = error || detail || 'bad response';
		throw new Error(message);
	}

	return response;
}

export default async function request<T>(options: RequestOptions): Promise<T> {
	const response = await _request({ ...options, ...globalRequestOptions });
	const data = await response.json().catch(() => ({ error: 'bad response' }));
	checkResponse(data);
	return data;
}
