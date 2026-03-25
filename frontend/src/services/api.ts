/**
 * services/api.ts
 * Centralised API client for SmartKYC frontend.
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    const err: any = new Error(detail?.detail || `${method} ${path} → ${res.status}`)
    err.response = { data: detail, status: res.status }
    throw err
  }
  // 204 No Content
  if (res.status === 204) return undefined as T
  return res.json()
}

// ─── Cases ────────────────────────────────────────────────────────────────────

export const casesApi = {
  list: (status?: string) =>
    request<any[]>('GET', `/api/cases/${status ? `?status=${status}` : ''}`),

  get: (id: string) =>
    request<any>('GET', `/api/cases/${id}`),

  create: (data: {
    subject_name: string
    subject_type?: string
    date_of_birth?: string
    nationality?: string
    notes?: string
  }) => request<any>('POST', '/api/cases/', data),

  startInvestigation: (id: string) =>
    request<any>('POST', `/api/cases/${id}/start-investigation`),

  dashboardSummary: (limit = 12) =>
    request<any[]>('GET', `/api/cases/dashboard/summary?limit=${limit}`),

  getEvents: (id: string) =>
    request<any[]>('GET', `/api/cases/${id}/events`),
}

// ─── Documents ────────────────────────────────────────────────────────────────

export const documentsApi = {
  upload: async (
    caseId: string,
    file: File,
    documentType?: string,
  ): Promise<any> => {
    const form = new FormData()
    form.append('file', file)
    if (documentType) form.append('document_type', documentType)

    const res = await fetch(`${BASE}/api/documents/upload/${caseId}`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      const err: any = new Error(detail?.detail || `Upload failed: ${res.status}`)
      err.response = { data: detail, status: res.status }
      throw err
    }
    return res.json()
  },

  getExtractions: (documentId: string) =>
    request<any[]>('GET', `/api/documents/${documentId}/extractions`),
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export const reviewsApi = {
  getQueue: () =>
    request<any[]>('GET', '/api/reviews/queue'),

  submit: (data: {
    case_id: string
    decision: string
    comments?: string
    reviewer_name?: string
    risk_override?: number
  }) => request<any>('POST', '/api/reviews/', data),

  getHistory: (caseId: string) =>
    request<any[]>('GET', `/api/reviews/history/${caseId}`),
}

// ─── Authorities ─────────────────────────────────────────────────────────────

export const authoritiesApi = {
  list: () =>
    request<any[]>('GET', '/api/authorities/'),

  forSubject: (params: {
    subject_type?: string
    nationality?: string
    document_types?: string
  }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
    ).toString()
    return request<any>('GET', `/api/authorities/by-subject${qs ? `?${qs}` : ''}`)
  },
}
