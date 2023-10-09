import Tor, { RequestMethod } from 'react-native-tor'
import AppError, { Err } from '../../utils/AppError';
import { log } from '../../utils/logger';

log.trace('Creating tor instance')
const tor = Tor()

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
    method?: RequestMethod,
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;

let globalRequestOptions: Partial<RequestOptions> = {};

export function setGlobalRequestOptions(options: Partial<RequestOptions>): void {
	globalRequestOptions = options;
}

async function _request<T>({
	endpoint,
	requestBody,
	headers: requestHeaders,
    method: requestMethod,    
	...options
}: RequestOptions): Promise<T> {

    log.trace('Starting tor if not yer running')
    await tor.startIfNotStarted()

	const body = requestBody ? JSON.stringify(requestBody) : undefined;
    const method = requestMethod ? requestMethod : RequestMethod.GET
	const headers = {
		...{ Accept: 'application/json, text/plain' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders
	};    

    switch (method.toLowerCase()) {
        case RequestMethod.GET:
            log.trace('GET tor request', {endpoint})
            const getResult = await tor.get(endpoint, headers, true);
            if (getResult.json) {
                log.trace('GET tor response', {response: getResult.json})
                return getResult.json;
            }
            break;
        case RequestMethod.POST:
            log.trace('POST tor request', {endpoint})
            const postResult = await tor.post(
                endpoint,
                body || '',
                headers,
                true
            );
            if (postResult.json) {
                log.trace('POST tor response', {response: postResult.json})
                return postResult.json;
            }
            break;
        case RequestMethod.DELETE:
            const deleteResult = await tor.delete(endpoint, body, headers, true);
            if (deleteResult.json) {
                return deleteResult.json;
            }
            break;
    }

    throw new AppError(Err.VALIDATION_ERROR, 'Invalid method', {method})
}

export default async function torRequest<T>(options: RequestOptions): Promise<T> {
	const response = await _request({ ...options, ...globalRequestOptions });	
	checkResponse(response);
	return response as T;
}


function checkResponse(data: any) {
	if (!isObj(data)) {
        throw new AppError(Err.VALIDATION_ERROR, 'Invalid data', {data})
    };
	
}

function isObj(v: unknown): v is object {
	return typeof v === 'object';
}