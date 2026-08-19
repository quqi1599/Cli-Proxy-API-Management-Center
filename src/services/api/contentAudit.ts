import { apiClient } from './client';

export type ContentAuditReviewLabel =
  | 'unreviewed'
  | 'confirmed_block'
  | 'false_positive'
  | 'needs_policy_change'
  | 'out_of_scope';

export interface ContentAuditStatus {
  enabled: boolean;
  audit_only: boolean;
  ready: boolean;
  error?: string;
  policy_version?: string;
  keyword_count: number;
  database_available: boolean;
  require_signed_identity: boolean;
  max_body_bytes: number;
  raw_retention_days: number;
  metadata_retention_days: number;
}

export interface ContentAuditEvent {
  id: string;
  created_at: number;
  request_id: string;
  user_id?: number;
  token_id?: number;
  token_name?: string;
  method: string;
  path: string;
  protocol: string;
  model?: string;
  stream: boolean;
  category: string;
  severity: string;
  rule_id: string;
  matched_term?: string;
  policy_version: string;
  request_bytes: number;
  identity_verified: boolean;
  upstream_sent: boolean;
  evidence_status: string;
  evidence_key_id: string;
  review_label: ContentAuditReviewLabel;
  review_note?: string;
  reviewed_at?: number;
  reviewed_by?: string;
}

export interface ContentAuditAccessLog {
  id: number;
  event_id: string;
  created_at: number;
  action: string;
  reason: string;
  actor: string;
}

export interface ContentAuditEventDetail extends ContentAuditEvent {
  access_history: ContentAuditAccessLog[];
}

export interface ContentAuditListResponse {
  items: ContentAuditEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface ContentAuditListParams {
  search?: string;
  category?: string;
  severity?: string;
  review_label?: string;
  user_id?: string;
  token_id?: string;
  page?: number;
  page_size?: number;
}

const toQueryString = (params: ContentAuditListParams): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || String(value).trim() === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const contentAuditApi = {
  getStatus: () => apiClient.get<ContentAuditStatus>('/content-audit/status'),
  listEvents: (params: ContentAuditListParams) =>
    apiClient.get<ContentAuditListResponse>(`/content-audit/events${toQueryString(params)}`),
  getEvent: (eventId: string) =>
    apiClient.get<ContentAuditEventDetail>(`/content-audit/events/${encodeURIComponent(eventId)}`),
  revealEvidence: (eventId: string) =>
    apiClient.post<{ event_id: string; evidence: unknown }>(
      `/content-audit/events/${encodeURIComponent(eventId)}/reveal`,
      {}
    ),
  reviewEvent: (
    eventId: string,
    payload: { label: ContentAuditReviewLabel; note: string; reason: string }
  ) =>
    apiClient.patch<{ status: string }>(
      `/content-audit/events/${encodeURIComponent(eventId)}/review`,
      payload
    ),
  recordAccess: (eventId: string, action: 'copy' | 'download', reason: string) =>
    apiClient.post<{ status: string }>(
      `/content-audit/events/${encodeURIComponent(eventId)}/access`,
      { action, reason }
    ),
};
