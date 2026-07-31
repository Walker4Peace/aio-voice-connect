import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AgentConfig, AgentTool, Client, CreateAgentConfigInput, CreateAgentToolInput, CreateClientInput, CreateExtensionInput, DashboardStats, ErrorResponse, Extension, HealthStatus, ListAgentToolsParams, ListExtensionsParams, ListOutboundCallsParams, OutboundCall, OutboundContext, TriggerOutboundCallInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetStatsUrl: () => string;
/**
 * @summary Get dashboard statistics
 */
export declare const getStats: (options?: RequestInit) => Promise<DashboardStats>;
export declare const getGetStatsQueryKey: () => readonly ["/api/stats"];
export declare const getGetStatsQueryOptions: <TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getStats>>>;
export type GetStatsQueryError = ErrorType<unknown>;
/**
 * @summary Get dashboard statistics
 */
export declare function useGetStats<TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListClientsUrl: () => string;
/**
 * @summary List all IPBXs
 */
export declare const listClients: (options?: RequestInit) => Promise<Client[]>;
export declare const getListClientsQueryKey: () => readonly ["/api/clients"];
export declare const getListClientsQueryOptions: <TData = Awaited<ReturnType<typeof listClients>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClients>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listClients>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListClientsQueryResult = NonNullable<Awaited<ReturnType<typeof listClients>>>;
export type ListClientsQueryError = ErrorType<unknown>;
/**
 * @summary List all IPBXs
 */
export declare function useListClients<TData = Awaited<ReturnType<typeof listClients>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClients>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateClientUrl: () => string;
/**
 * @summary Create an IPBX
 */
export declare const createClient: (createClientInput: CreateClientInput, options?: RequestInit) => Promise<Client>;
export declare const getCreateClientMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClient>>, TError, {
        data: BodyType<CreateClientInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createClient>>, TError, {
    data: BodyType<CreateClientInput>;
}, TContext>;
export type CreateClientMutationResult = NonNullable<Awaited<ReturnType<typeof createClient>>>;
export type CreateClientMutationBody = BodyType<CreateClientInput>;
export type CreateClientMutationError = ErrorType<unknown>;
/**
* @summary Create an IPBX
*/
export declare const useCreateClient: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClient>>, TError, {
        data: BodyType<CreateClientInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createClient>>, TError, {
    data: BodyType<CreateClientInput>;
}, TContext>;
export declare const getGetClientUrl: (id: number) => string;
/**
 * @summary Get an IPBX by ID
 */
export declare const getClient: (id: number, options?: RequestInit) => Promise<Client>;
export declare const getGetClientQueryKey: (id: number) => readonly [`/api/clients/${number}`];
export declare const getGetClientQueryOptions: <TData = Awaited<ReturnType<typeof getClient>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClient>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getClient>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetClientQueryResult = NonNullable<Awaited<ReturnType<typeof getClient>>>;
export type GetClientQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get an IPBX by ID
 */
export declare function useGetClient<TData = Awaited<ReturnType<typeof getClient>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClient>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateClientUrl: (id: number) => string;
/**
 * @summary Update an IPBX
 */
export declare const updateClient: (id: number, createClientInput: CreateClientInput, options?: RequestInit) => Promise<Client>;
export declare const getUpdateClientMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClient>>, TError, {
        id: number;
        data: BodyType<CreateClientInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateClient>>, TError, {
    id: number;
    data: BodyType<CreateClientInput>;
}, TContext>;
export type UpdateClientMutationResult = NonNullable<Awaited<ReturnType<typeof updateClient>>>;
export type UpdateClientMutationBody = BodyType<CreateClientInput>;
export type UpdateClientMutationError = ErrorType<unknown>;
/**
* @summary Update an IPBX
*/
export declare const useUpdateClient: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClient>>, TError, {
        id: number;
        data: BodyType<CreateClientInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateClient>>, TError, {
    id: number;
    data: BodyType<CreateClientInput>;
}, TContext>;
export declare const getDeleteClientUrl: (id: number) => string;
/**
 * @summary Delete an IPBX
 */
export declare const deleteClient: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteClientMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteClient>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteClient>>, TError, {
    id: number;
}, TContext>;
export type DeleteClientMutationResult = NonNullable<Awaited<ReturnType<typeof deleteClient>>>;
export type DeleteClientMutationError = ErrorType<unknown>;
/**
* @summary Delete an IPBX
*/
export declare const useDeleteClient: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteClient>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteClient>>, TError, {
    id: number;
}, TContext>;
export declare const getListExtensionsUrl: (params?: ListExtensionsParams) => string;
/**
 * @summary List all extensions
 */
export declare const listExtensions: (params?: ListExtensionsParams, options?: RequestInit) => Promise<Extension[]>;
export declare const getListExtensionsQueryKey: (params?: ListExtensionsParams) => readonly ["/api/extensions", ...ListExtensionsParams[]];
export declare const getListExtensionsQueryOptions: <TData = Awaited<ReturnType<typeof listExtensions>>, TError = ErrorType<unknown>>(params?: ListExtensionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listExtensions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listExtensions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListExtensionsQueryResult = NonNullable<Awaited<ReturnType<typeof listExtensions>>>;
export type ListExtensionsQueryError = ErrorType<unknown>;
/**
 * @summary List all extensions
 */
export declare function useListExtensions<TData = Awaited<ReturnType<typeof listExtensions>>, TError = ErrorType<unknown>>(params?: ListExtensionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listExtensions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateExtensionUrl: () => string;
/**
 * @summary Create an extension
 */
export declare const createExtension: (createExtensionInput: CreateExtensionInput, options?: RequestInit) => Promise<Extension>;
export declare const getCreateExtensionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createExtension>>, TError, {
        data: BodyType<CreateExtensionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createExtension>>, TError, {
    data: BodyType<CreateExtensionInput>;
}, TContext>;
export type CreateExtensionMutationResult = NonNullable<Awaited<ReturnType<typeof createExtension>>>;
export type CreateExtensionMutationBody = BodyType<CreateExtensionInput>;
export type CreateExtensionMutationError = ErrorType<unknown>;
/**
* @summary Create an extension
*/
export declare const useCreateExtension: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createExtension>>, TError, {
        data: BodyType<CreateExtensionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createExtension>>, TError, {
    data: BodyType<CreateExtensionInput>;
}, TContext>;
export declare const getGetExtensionUrl: (id: number) => string;
/**
 * @summary Get an extension by ID
 */
export declare const getExtension: (id: number, options?: RequestInit) => Promise<Extension>;
export declare const getGetExtensionQueryKey: (id: number) => readonly [`/api/extensions/${number}`];
export declare const getGetExtensionQueryOptions: <TData = Awaited<ReturnType<typeof getExtension>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getExtension>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getExtension>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetExtensionQueryResult = NonNullable<Awaited<ReturnType<typeof getExtension>>>;
export type GetExtensionQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get an extension by ID
 */
export declare function useGetExtension<TData = Awaited<ReturnType<typeof getExtension>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getExtension>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateExtensionUrl: (id: number) => string;
/**
 * @summary Update an extension
 */
export declare const updateExtension: (id: number, createExtensionInput: CreateExtensionInput, options?: RequestInit) => Promise<Extension>;
export declare const getUpdateExtensionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateExtension>>, TError, {
        id: number;
        data: BodyType<CreateExtensionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateExtension>>, TError, {
    id: number;
    data: BodyType<CreateExtensionInput>;
}, TContext>;
export type UpdateExtensionMutationResult = NonNullable<Awaited<ReturnType<typeof updateExtension>>>;
export type UpdateExtensionMutationBody = BodyType<CreateExtensionInput>;
export type UpdateExtensionMutationError = ErrorType<unknown>;
/**
* @summary Update an extension
*/
export declare const useUpdateExtension: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateExtension>>, TError, {
        id: number;
        data: BodyType<CreateExtensionInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateExtension>>, TError, {
    id: number;
    data: BodyType<CreateExtensionInput>;
}, TContext>;
export declare const getDeleteExtensionUrl: (id: number) => string;
/**
 * @summary Delete an extension
 */
export declare const deleteExtension: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteExtensionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteExtension>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteExtension>>, TError, {
    id: number;
}, TContext>;
export type DeleteExtensionMutationResult = NonNullable<Awaited<ReturnType<typeof deleteExtension>>>;
export type DeleteExtensionMutationError = ErrorType<unknown>;
/**
* @summary Delete an extension
*/
export declare const useDeleteExtension: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteExtension>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteExtension>>, TError, {
    id: number;
}, TContext>;
export declare const getListAgentConfigsUrl: () => string;
/**
 * @summary List all agent configs
 */
export declare const listAgentConfigs: (options?: RequestInit) => Promise<AgentConfig[]>;
export declare const getListAgentConfigsQueryKey: () => readonly ["/api/agent-configs"];
export declare const getListAgentConfigsQueryOptions: <TData = Awaited<ReturnType<typeof listAgentConfigs>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAgentConfigs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAgentConfigs>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAgentConfigsQueryResult = NonNullable<Awaited<ReturnType<typeof listAgentConfigs>>>;
export type ListAgentConfigsQueryError = ErrorType<unknown>;
/**
 * @summary List all agent configs
 */
export declare function useListAgentConfigs<TData = Awaited<ReturnType<typeof listAgentConfigs>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAgentConfigs>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateAgentConfigUrl: () => string;
/**
 * @summary Create an agent config
 */
export declare const createAgentConfig: (createAgentConfigInput: CreateAgentConfigInput, options?: RequestInit) => Promise<AgentConfig>;
export declare const getCreateAgentConfigMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAgentConfig>>, TError, {
        data: BodyType<CreateAgentConfigInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAgentConfig>>, TError, {
    data: BodyType<CreateAgentConfigInput>;
}, TContext>;
export type CreateAgentConfigMutationResult = NonNullable<Awaited<ReturnType<typeof createAgentConfig>>>;
export type CreateAgentConfigMutationBody = BodyType<CreateAgentConfigInput>;
export type CreateAgentConfigMutationError = ErrorType<unknown>;
/**
* @summary Create an agent config
*/
export declare const useCreateAgentConfig: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAgentConfig>>, TError, {
        data: BodyType<CreateAgentConfigInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAgentConfig>>, TError, {
    data: BodyType<CreateAgentConfigInput>;
}, TContext>;
export declare const getGetAgentConfigUrl: (id: number) => string;
/**
 * @summary Get an agent config by ID
 */
export declare const getAgentConfig: (id: number, options?: RequestInit) => Promise<AgentConfig>;
export declare const getGetAgentConfigQueryKey: (id: number) => readonly [`/api/agent-configs/${number}`];
export declare const getGetAgentConfigQueryOptions: <TData = Awaited<ReturnType<typeof getAgentConfig>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentConfig>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAgentConfig>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAgentConfigQueryResult = NonNullable<Awaited<ReturnType<typeof getAgentConfig>>>;
export type GetAgentConfigQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get an agent config by ID
 */
export declare function useGetAgentConfig<TData = Awaited<ReturnType<typeof getAgentConfig>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentConfig>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateAgentConfigUrl: (id: number) => string;
/**
 * @summary Update an agent config
 */
export declare const updateAgentConfig: (id: number, createAgentConfigInput: CreateAgentConfigInput, options?: RequestInit) => Promise<AgentConfig>;
export declare const getUpdateAgentConfigMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAgentConfig>>, TError, {
        id: number;
        data: BodyType<CreateAgentConfigInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAgentConfig>>, TError, {
    id: number;
    data: BodyType<CreateAgentConfigInput>;
}, TContext>;
export type UpdateAgentConfigMutationResult = NonNullable<Awaited<ReturnType<typeof updateAgentConfig>>>;
export type UpdateAgentConfigMutationBody = BodyType<CreateAgentConfigInput>;
export type UpdateAgentConfigMutationError = ErrorType<unknown>;
/**
* @summary Update an agent config
*/
export declare const useUpdateAgentConfig: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAgentConfig>>, TError, {
        id: number;
        data: BodyType<CreateAgentConfigInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAgentConfig>>, TError, {
    id: number;
    data: BodyType<CreateAgentConfigInput>;
}, TContext>;
export declare const getDeleteAgentConfigUrl: (id: number) => string;
/**
 * @summary Delete an agent config
 */
export declare const deleteAgentConfig: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteAgentConfigMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAgentConfig>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteAgentConfig>>, TError, {
    id: number;
}, TContext>;
export type DeleteAgentConfigMutationResult = NonNullable<Awaited<ReturnType<typeof deleteAgentConfig>>>;
export type DeleteAgentConfigMutationError = ErrorType<unknown>;
/**
* @summary Delete an agent config
*/
export declare const useDeleteAgentConfig: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAgentConfig>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteAgentConfig>>, TError, {
    id: number;
}, TContext>;
export declare const getListAgentToolsUrl: (params: ListAgentToolsParams) => string;
/**
 * @summary List tools for an agent config
 */
export declare const listAgentTools: (params: ListAgentToolsParams, options?: RequestInit) => Promise<AgentTool[]>;
export declare const getListAgentToolsQueryKey: (params?: ListAgentToolsParams) => readonly ["/api/agent-tools", ...ListAgentToolsParams[]];
export declare const getListAgentToolsQueryOptions: <TData = Awaited<ReturnType<typeof listAgentTools>>, TError = ErrorType<unknown>>(params: ListAgentToolsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAgentTools>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAgentTools>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAgentToolsQueryResult = NonNullable<Awaited<ReturnType<typeof listAgentTools>>>;
export type ListAgentToolsQueryError = ErrorType<unknown>;
/**
 * @summary List tools for an agent config
 */
export declare function useListAgentTools<TData = Awaited<ReturnType<typeof listAgentTools>>, TError = ErrorType<unknown>>(params: ListAgentToolsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAgentTools>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateAgentToolUrl: () => string;
/**
 * @summary Create an agent tool
 */
export declare const createAgentTool: (createAgentToolInput: CreateAgentToolInput, options?: RequestInit) => Promise<AgentTool>;
export declare const getCreateAgentToolMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAgentTool>>, TError, {
        data: BodyType<CreateAgentToolInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAgentTool>>, TError, {
    data: BodyType<CreateAgentToolInput>;
}, TContext>;
export type CreateAgentToolMutationResult = NonNullable<Awaited<ReturnType<typeof createAgentTool>>>;
export type CreateAgentToolMutationBody = BodyType<CreateAgentToolInput>;
export type CreateAgentToolMutationError = ErrorType<unknown>;
/**
* @summary Create an agent tool
*/
export declare const useCreateAgentTool: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAgentTool>>, TError, {
        data: BodyType<CreateAgentToolInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAgentTool>>, TError, {
    data: BodyType<CreateAgentToolInput>;
}, TContext>;
export declare const getGetAgentToolUrl: (id: number) => string;
/**
 * @summary Get an agent tool by ID
 */
export declare const getAgentTool: (id: number, options?: RequestInit) => Promise<AgentTool>;
export declare const getGetAgentToolQueryKey: (id: number) => readonly [`/api/agent-tools/${number}`];
export declare const getGetAgentToolQueryOptions: <TData = Awaited<ReturnType<typeof getAgentTool>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentTool>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAgentTool>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAgentToolQueryResult = NonNullable<Awaited<ReturnType<typeof getAgentTool>>>;
export type GetAgentToolQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get an agent tool by ID
 */
export declare function useGetAgentTool<TData = Awaited<ReturnType<typeof getAgentTool>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAgentTool>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateAgentToolUrl: (id: number) => string;
/**
 * @summary Update an agent tool
 */
export declare const updateAgentTool: (id: number, createAgentToolInput: CreateAgentToolInput, options?: RequestInit) => Promise<AgentTool>;
export declare const getUpdateAgentToolMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAgentTool>>, TError, {
        id: number;
        data: BodyType<CreateAgentToolInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAgentTool>>, TError, {
    id: number;
    data: BodyType<CreateAgentToolInput>;
}, TContext>;
export type UpdateAgentToolMutationResult = NonNullable<Awaited<ReturnType<typeof updateAgentTool>>>;
export type UpdateAgentToolMutationBody = BodyType<CreateAgentToolInput>;
export type UpdateAgentToolMutationError = ErrorType<unknown>;
/**
* @summary Update an agent tool
*/
export declare const useUpdateAgentTool: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAgentTool>>, TError, {
        id: number;
        data: BodyType<CreateAgentToolInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAgentTool>>, TError, {
    id: number;
    data: BodyType<CreateAgentToolInput>;
}, TContext>;
export declare const getDeleteAgentToolUrl: (id: number) => string;
/**
 * @summary Delete an agent tool
 */
export declare const deleteAgentTool: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteAgentToolMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAgentTool>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteAgentTool>>, TError, {
    id: number;
}, TContext>;
export type DeleteAgentToolMutationResult = NonNullable<Awaited<ReturnType<typeof deleteAgentTool>>>;
export type DeleteAgentToolMutationError = ErrorType<unknown>;
/**
* @summary Delete an agent tool
*/
export declare const useDeleteAgentTool: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAgentTool>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteAgentTool>>, TError, {
    id: number;
}, TContext>;
export declare const getTriggerOutboundCallUrl: () => string;
/**
 * @summary Trigger an outbound call (public — use X-Api-Key header)
 */
export declare const triggerOutboundCall: (triggerOutboundCallInput: TriggerOutboundCallInput, options?: RequestInit) => Promise<OutboundCall>;
export declare const getTriggerOutboundCallMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerOutboundCall>>, TError, {
        data: BodyType<TriggerOutboundCallInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof triggerOutboundCall>>, TError, {
    data: BodyType<TriggerOutboundCallInput>;
}, TContext>;
export type TriggerOutboundCallMutationResult = NonNullable<Awaited<ReturnType<typeof triggerOutboundCall>>>;
export type TriggerOutboundCallMutationBody = BodyType<TriggerOutboundCallInput>;
export type TriggerOutboundCallMutationError = ErrorType<ErrorResponse>;
/**
* @summary Trigger an outbound call (public — use X-Api-Key header)
*/
export declare const useTriggerOutboundCall: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof triggerOutboundCall>>, TError, {
        data: BodyType<TriggerOutboundCallInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof triggerOutboundCall>>, TError, {
    data: BodyType<TriggerOutboundCallInput>;
}, TContext>;
export declare const getListOutboundCallsUrl: (params?: ListOutboundCallsParams) => string;
/**
 * @summary List outbound call history
 */
export declare const listOutboundCalls: (params?: ListOutboundCallsParams, options?: RequestInit) => Promise<OutboundCall[]>;
export declare const getListOutboundCallsQueryKey: (params?: ListOutboundCallsParams) => readonly ["/api/outbound/calls", ...ListOutboundCallsParams[]];
export declare const getListOutboundCallsQueryOptions: <TData = Awaited<ReturnType<typeof listOutboundCalls>>, TError = ErrorType<unknown>>(params?: ListOutboundCallsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listOutboundCalls>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listOutboundCalls>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListOutboundCallsQueryResult = NonNullable<Awaited<ReturnType<typeof listOutboundCalls>>>;
export type ListOutboundCallsQueryError = ErrorType<unknown>;
/**
 * @summary List outbound call history
 */
export declare function useListOutboundCalls<TData = Awaited<ReturnType<typeof listOutboundCalls>>, TError = ErrorType<unknown>>(params?: ListOutboundCallsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listOutboundCalls>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOutboundCallUrl: (id: number) => string;
/**
 * @summary Get an outbound call by ID
 */
export declare const getOutboundCall: (id: number, options?: RequestInit) => Promise<OutboundCall>;
export declare const getGetOutboundCallQueryKey: (id: number) => readonly [`/api/outbound/calls/${number}`];
export declare const getGetOutboundCallQueryOptions: <TData = Awaited<ReturnType<typeof getOutboundCall>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOutboundCall>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOutboundCall>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOutboundCallQueryResult = NonNullable<Awaited<ReturnType<typeof getOutboundCall>>>;
export type GetOutboundCallQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get an outbound call by ID
 */
export declare function useGetOutboundCall<TData = Awaited<ReturnType<typeof getOutboundCall>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOutboundCall>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOutboundContextUrl: (extensionId: number) => string;
/**
 * @summary Get pending outbound call context for an extension (called by sip-agent)
 */
export declare const getOutboundContext: (extensionId: number, options?: RequestInit) => Promise<OutboundContext>;
export declare const getGetOutboundContextQueryKey: (extensionId: number) => readonly [`/api/outbound/context/${number}`];
export declare const getGetOutboundContextQueryOptions: <TData = Awaited<ReturnType<typeof getOutboundContext>>, TError = ErrorType<unknown>>(extensionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOutboundContext>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOutboundContext>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOutboundContextQueryResult = NonNullable<Awaited<ReturnType<typeof getOutboundContext>>>;
export type GetOutboundContextQueryError = ErrorType<unknown>;
/**
 * @summary Get pending outbound call context for an extension (called by sip-agent)
 */
export declare function useGetOutboundContext<TData = Awaited<ReturnType<typeof getOutboundContext>>, TError = ErrorType<unknown>>(extensionId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOutboundContext>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map