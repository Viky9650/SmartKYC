export interface Case {
  id: string
  case_number: string
  subject_name: string
  subject_type: string
  date_of_birth?: string
  nationality?: string
  notes?: string
  status: CaseStatus
  risk_score: number
  risk_level: RiskLevel
  created_at: string
}

export type CaseStatus =
  | 'pending'
  | 'investigating'
  | 'review'
  | 'cleared'
  | 'rejected'
  | 'on_hold'
  | 'escalated'
  | 'pending_documents'

export type RiskLevel = 'unknown' | 'low' | 'medium' | 'high' | 'critical'

export type ReviewDecision = 'approved' | 'rejected' | 'on_hold' | 'escalated' | 'request_documents'

export interface AgentResult {
  id?: string
  agent_name: string
  risk_score: number
  flags: string[]
  summary: string
  confidence: number
  evidence: Record<string, any>
  status: string
  completed_at?: string
}

export interface VerificationSource {
  id?: string
  source_name: string
  source_type: string
  result: string
  result_detail: Record<string, any>
  is_mock: boolean
  checked_at?: string
}

export interface DocumentRecord {
  id: string
  filename: string
  original_filename?: string
  document_type: string
  country_of_issue?: string
  extraction_status: string
  extracted_data: ExtractedData
  uploaded_at?: string
}

export interface ExtractedData {
  document_schema?: string
  document_type?: string
  country?: string
  issuer?: string
  full_name?: string
  fields: Record<string, string>
  confidences: Record<string, number>
  overall_confidence?: number
  extraction_method?: string
}

export interface InvestigationEvent {
  id: string
  event_type: string
  event_data: Record<string, any>
  message: string
  timestamp: string
}

export interface HumanReview {
  id: string
  reviewer_name: string
  decision: ReviewDecision
  comments?: string
  risk_override?: number
  reviewed_at: string
}

export interface CaseDetail {
  case: Case
  investigation_plan?: InvestigationPlan
  agents: AgentResult[]
  verification_sources: VerificationSource[]
  documents: DocumentRecord[]
  events: InvestigationEvent[]
  reviews: HumanReview[]
}

export interface InvestigationPlan {
  investigation_plan: string[]
  reasoning: string
  risk_indicators: string[]
  priority_level: string
  estimated_risk?: number
}

export interface VerificationAuthority {
  key: string
  name: string
  full_name: string
  type: string
  country: string
  description: string
  is_free: boolean
  url: string
  mock_mode: boolean
  api_configured: boolean
  real_api_endpoint?: string
}
