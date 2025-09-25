import { StreamClient, UR, DefaultGenerics } from './client';
export interface AuditLog {
    action: string;
    created_at: string;
    custom: Record<string, unknown>;
    entity_id: string;
    entity_type: string;
    user_id: string;
}
export interface AuditLogFilterAPIResponse {
    audit_logs: AuditLog[];
    duration: string;
    next?: string;
    prev?: string;
}
export interface AuditLogFilterOptions extends UR {
    entity_id?: string;
    entity_type?: string;
    limit?: number;
    next?: string;
    prev?: string;
    user_id?: string;
}
export declare class StreamAuditLogs<StreamFeedGenerics extends DefaultGenerics = DefaultGenerics> {
    token: string;
    client: StreamClient<StreamFeedGenerics>;
    constructor(client: StreamClient<StreamFeedGenerics>, token: string);
    buildURL(...args: string[]): string;
    filter(options?: AuditLogFilterOptions): Promise<AuditLogFilterAPIResponse>;
}
//# sourceMappingURL=audit_logs.d.ts.map