/**
 * SmartKYC API service layer
 * 
 * This file replaces (or is the base for) src/services/api.ts
 * It adds casesApi.update() (PATCH /api/cases/:id) and ensures
 * documentsApi.upload() returns the full extraction result.
 */

import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const http = axios.create({ baseURL: BASE })

// ── Cases ─────────────────────────────────────────────────────────────────────
export const casesApi = {
  list: (status?: string, limit = 500) =>
    http.get('/api/cases/', { params: { ...(status ? { status } : {}), limit } }).then(r => r.data),

  get: (id: string) =>
    http.get(`/api/cases/${id}`).then(r => r.data),

  create: (data: {
    subject_name: string
    subject_type?: string
    date_of_birth?: string
    nationality?: string
    notes?: string
  }) => http.post('/api/cases/', data).then(r => r.data),

  /** PATCH — update subject info after document extraction */
  update: (id: string, data: {
    subject_name?: string
    subject_type?: string
    date_of_birth?: string
    nationality?: string
    notes?: string
  }) => http.patch(`/api/cases/${id}`, data).then(r => r.data),

  startInvestigation: (id: string) =>
    http.post(`/api/cases/${id}/start-investigation`).then(r => r.data),

  /** POST — save updated fields and re-run the full investigation */
  reinvestigate: (id: string, data: {
    subject_name?: string
    subject_type?: string
    date_of_birth?: string
    nationality?: string
    notes?: string
  }) => http.post(`/api/cases/${id}/reinvestigate`, data).then(r => r.data),

  getEvents: (id: string) =>
    http.get(`/api/cases/${id}/events`).then(r => r.data),

  dashboardSummary: (limit = 10) =>
    http.get('/api/cases/dashboard/summary', { params: { limit } }).then(r => r.data),
}

// ── Documents ─────────────────────────────────────────────────────────────────
export const documentsApi = {
  /**
   * Upload an ID document for a case.
   * Returns the full server response including:
   *   - document_id, document_type, filename, file_size
   *   - extracted_data  (persisted extraction with all fields)
   *   - extraction      (full live extraction result, including full_name,
   *                      overall_confidence, extraction_method, etc.)
   */
  upload: (caseId: string, file: File, documentType?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (documentType) fd.append('document_type', documentType)
    return http
      .post(`/api/documents/upload/${caseId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(r => r.data)
  },

  getExtractions: (documentId: string) =>
    http.get(`/api/documents/${documentId}/extractions`).then(r => r.data),
}

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsApi = {
  list: () => http.get('/api/reviews/').then(r => r.data),

  getQueue: (sort?: string) =>
    http.get('/api/reviews/queue', { params: sort ? { sort } : {} }).then(r => r.data),

  submit: (caseId: string, data: {
    decision: string
    reviewer_name: string
    comments?: string
  }) => http.post('/api/reviews/', { ...data, case_id: caseId }).then(r => r.data),
}

// ── Chat history ──────────────────────────────────────────────────────────────
export const chatApi = {
  listSessions: () =>
    http.get('/api/chat/history').then(r => r.data),

  getSession: (sessionId: string) =>
    http.get(`/api/chat/history/${sessionId}`).then(r => r.data),

  saveSession: (data: {
    session_id: string
    started_at: string
    messages: any[]
    cases_created: string[]
  }) => http.post('/api/chat/history', data).then(r => r.data),

  deleteSession: (sessionId: string) =>
    http.delete(`/api/chat/history/${sessionId}`).then(r => r.data),
}

// ── Authorities ───────────────────────────────────────────────────────────────
export const authoritiesApi = {
  list: () => http.get('/api/authorities/').then(r => r.data),
}
