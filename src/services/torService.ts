import Tor, { RequestMethod, TorType } from 'react-native-tor'
import AppError, { Err } from '../utils/AppError';
import { log } from './logService';

let _tor: TorType
let _globalRequestOptions: Partial<RequestOptions> = {};

const getInstance = function () {
    if (!_tor) {        
        _tor = Tor()
        log.trace('Tor initialized')
    }
  
    return _tor
}

type RequestArgs = {
	endpoint: string;
	requestBody?: Record<string, unknown>;
	headers?: Record<string, string>;
    method?: string | RequestMethod,
};

type RequestOptions = RequestArgs & Omit<RequestInit, 'body' | 'headers'>;


const setGlobalRequestOptions = function (options: Partial<RequestOptions>): void {
	_globalRequestOptions = options;
}

const _request = async function<T>({
	endpoint,
	requestBody,
	headers: requestHeaders,
    method: requestMethod,    
	...options
}: RequestOptions): Promise<T> {

    const tor = getInstance()

    log.trace('[_request]', 'Starting tor if not yet running')
    await tor.startIfNotStarted()
    log.trace('_request', 'Tor daemon started')

	const body = requestBody ? JSON.stringify(requestBody) : undefined;
    const method = requestMethod ? requestMethod : RequestMethod.GET
	const headers = {
		...{ Accept: 'application/json, text/plain' },
		...(body ? { 'Content-Type': 'application/json' } : undefined),
		...requestHeaders
	};    

    switch (method.toLowerCase()) {
        case RequestMethod.GET:
            log.trace('[GET] tor request', {endpoint})
            const getResult = await tor.get(endpoint, headers, true);
            if (getResult.json) {
                log.trace('[GET] tor response', {response: getResult.json})
                return getResult.json;
            }
            break;
        case RequestMethod.POST:
            log.trace('[POST] tor request', {endpoint})
            const postResult = await tor.post(
                endpoint,
                body || '',
                headers,
                true
            );
            if (postResult.json) {
                log.trace('[POST] tor response', {response: postResult.json})
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

const torRequest = async function<T>(options: RequestOptions): Promise<T> {
	const response = await _request({ ...options, ..._globalRequestOptions });	
	checkResponse(response);
	return response as T;
}


const checkResponse = function(data: any) {
	if (!isObj(data)) {
        throw new AppError(Err.VALIDATION_ERROR, 'Invalid data', {data})
    };
	
}

const isObj = function(v: unknown): v is object {
	return typeof v === 'object';
}

export const TorDaemon = {
    getInstance,
    torRequest,
    setGlobalRequestOptions,
}