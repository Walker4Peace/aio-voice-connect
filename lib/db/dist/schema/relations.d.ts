export declare const clientsRelations: import("drizzle-orm").Relations<"clients", {
    extensions: import("drizzle-orm").Many<"extensions">;
}>;
export declare const extensionsRelations: import("drizzle-orm").Relations<"extensions", {
    client: import("drizzle-orm").One<"clients", false>;
    agentConfig: import("drizzle-orm").One<"agent_configs", false>;
    deployment: import("drizzle-orm").One<"deployments", true>;
    outboundCalls: import("drizzle-orm").Many<"outbound_calls">;
}>;
export declare const agentConfigsRelations: import("drizzle-orm").Relations<"agent_configs", {
    extensions: import("drizzle-orm").Many<"extensions">;
    tools: import("drizzle-orm").Many<"agent_tools">;
}>;
export declare const agentToolsRelations: import("drizzle-orm").Relations<"agent_tools", {
    agentConfig: import("drizzle-orm").One<"agent_configs", true>;
}>;
export declare const outboundCallsRelations: import("drizzle-orm").Relations<"outbound_calls", {
    extension: import("drizzle-orm").One<"extensions", false>;
}>;
//# sourceMappingURL=relations.d.ts.map