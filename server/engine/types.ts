// Hợp đồng dữ liệu giữa probe, detection engine và giao diện (PHẦN 4 của đặc tả)

export type ModuleStatus = 'PASS' | 'WARNING' | 'FAIL' | 'UNAVAILABLE';
export type RuleSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PriorityTier = 'P0' | 'P1';
export type EnforcementAction = 'ALLOW' | 'CHALLENGE' | 'BLOCK';

export type ModuleId =
  | 'canvas' | 'webrtc' | 'browser_info' | 'webgl' | 'hardware'
  | 'locale' | 'audio' | 'fonts' | 'automation' | 'network';

export type CorrelationGroupId =
  | 'GRP_CANVAS_TAMPER' | 'GRP_WEBRTC_NET' | 'GRP_UA_IDENTITY' | 'GRP_PROTO_HOOK'
  | 'GRP_GPU_ARCH' | 'GRP_HW_LIMITS' | 'GRP_GEO_LOCALE' | 'GRP_AUDIO_SPOOF'
  | 'GRP_FONT_RENDER' | 'GRP_BOT_RUNTIME' | 'GRP_TLS_HTTP';

export const GROUP_IDS: CorrelationGroupId[] = [
  'GRP_CANVAS_TAMPER', 'GRP_WEBRTC_NET', 'GRP_UA_IDENTITY', 'GRP_PROTO_HOOK', 'GRP_GPU_ARCH',
  'GRP_HW_LIMITS', 'GRP_GEO_LOCALE', 'GRP_AUDIO_SPOOF', 'GRP_FONT_RENDER', 'GRP_BOT_RUNTIME', 'GRP_TLS_HTTP',
];

export interface RuleEvaluationResult {
  rule_id: string;
  name: string;
  module_id: ModuleId;
  group_id: CorrelationGroupId;
  status: ModuleStatus;
  severity: RuleSeverity;
  base_weight: number;          // w_i
  confidence: number;           // c_i
  effective_score: number;      // s_i = w_i * c_i (trước damping)
  contributed_score: number;    // phần thực sự cộng vào R sau damping theo nhóm
  observed_value: unknown;
  expected_baseline: string;
  evidence_explanation: string;
  message: string;              // kết luận ngắn của lần đánh giá này
}

export interface ModuleDiagnosticReport {
  module_id: ModuleId;
  title: string;
  priority: PriorityTier;
  status: ModuleStatus;
  module_risk_points: number;
  confidence: number;
  summary_headline: string;
  key_metrics: Array<{ label: string; value: string; is_anomalous?: boolean }>;
  reference_baseline: string;
  stability_check?: {
    run_1_hash: string;
    run_2_hash: string;
    worker_or_iframe_hash?: string;
    main_context_hash?: string;
    is_deterministic: boolean;
    note?: string;
  };
  observed_raw_data: Record<string, unknown>;
  rules_evaluated: RuleEvaluationResult[];
}

export interface GroupScore {
  max_rule_score: number;
  damped_additional_score: number;
  group_total: number;
  triggered_rules: string[];
}

export interface ScanReportResponse {
  scan_id: string;
  timestamp: string;
  ruleset_version: string;
  simulated_profile?: string;
  environment_summary: {
    declared_user_agent: string;
    declared_os: string;
    declared_browser: string;
    inferred_real_os: string;
    inferred_real_engine: string;
    client_ip: string;
    asn_org: string;
    country_code: string;
  };
  scoring_breakdown: {
    /** 100 = trình duyệt hoàn hảo; = 100 - total_risk_score */
    trust_score: number;
    /** Tổng điểm bị trừ (0 - 100) sau damping theo nhóm và hard-block */
    total_risk_score: number;
    raw_score: number;
    overall_confidence: number;
    risk_label: 'Safe' | 'Suspicious' | 'High Risk (Antidetect)';
    enforcement_action: EnforcementAction;
    hard_block_triggered: boolean;
    hard_block_reason?: string;
    hard_block_rules?: string[];
    /** Ngưỡng Trust: ≥ safe → ALLOW, ≥ suspicious → CHALLENGE, còn lại BLOCK */
    thresholds: { safe: number; suspicious: number };
    damping: number;
    hard_block_policy: { enabled: boolean; minRules: number; minConfidence: number; maxTrust: number };
    group_scores: Record<CorrelationGroupId, GroupScore>;
  };
  module_summary_counts: Record<ModuleStatus, number>;
  top_signals: Array<{ rule_id: string; name: string; module_id: ModuleId; status: ModuleStatus; contributed_score: number; message: string }>;
  modules: ModuleDiagnosticReport[];
}

/** Dữ liệu tầng mạng do Edge/Reverse proxy cung cấp (JA4, HTTP/2, p0f, ASN, GeoIP). */
export interface NetIntel {
  ja4?: string;
  ja3?: string;
  tlsClient?: string;     // họ client do edge tự phân loại: chrome | firefox | safari | curl | python | go | node...
  h2?: string;            // Akamai HTTP/2 fingerprint: SETTINGS|WINDOW_UPDATE|PRIORITY|pseudo-header order
  httpVersion?: string;
  tcpOs?: string;         // p0f: Windows | Linux | macOS | iOS | Android
  asn?: string;
  asnOrg?: string;
  asnType?: string;       // residential | mobile | business | hosting | education
  country?: string;
  ipTimezone?: string;
  ipFlags?: string[];     // tor | proxy | vpn | abuse
  webrtcIp?: { ip?: string; asn?: string; asnOrg?: string; asnType?: string; country?: string };
  /** STUN/TURN đối chiếu trên VPS: IP:port nguồn thật của gói WebRTC (vps/stun-listener.cjs) */
  ground?: {
    vps?: string;
    error?: string;
    sources?: { ip: string; port: number; proto: 'udp' | 'tcp'; kinds: string[]; first: number; last: number; count: number }[];
    bindings?: { ip: string; port: number; proto: 'udp' | 'tcp'; t: number }[];
  };
}
