/**
 * Standalone document upload component — used on CaseDetailPage
 * to attach additional documents to an existing case.
 * The NewCasePage has its own inline upload zone.
 */
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { documentsApi } from '../../services/api'
import { ConfidenceBar, Spinner } from '../shared/UI'

const DOC_TYPES = [
  { value: '', label: 'Auto-detect from filename' },
  { value: 'IN_PASSPORT',         label: '🇮🇳 India — Passport' },
  { value: 'IN_AADHAAR',          label: '🇮🇳 India — Aadhaar Card' },
  { value: 'IN_PAN',              label: '🇮🇳 India — PAN Card' },
  { value: 'IN_VOTER_ID',         label: '🇮🇳 India — Voter ID' },
  { value: 'IN_DRIVING_LICENSE',  label: '🇮🇳 India — Driving License' },
  { value: 'GB_PASSPORT',         label: '🇬🇧 UK — Passport' },
  { value: 'GB_DRIVING_LICENSE',  label: '🇬🇧 UK — Driving Licence' },
  { value: 'US_PASSPORT',         label: '🇺🇸 US — Passport' },
  { value: 'US_DRIVERS_LICENSE',  label: '🇺🇸 US — Driver\'s License' },
  { value: 'EU_PASSPORT',         label: '🇪🇺 EU — Passport' },
  { value: 'EU_NATIONAL_ID',      label: '🇪🇺 EU — National ID' },
  { value: 'RU_PASSPORT',         label: '🇷🇺 Russia — Passport' },
  { value: 'AE_PASSPORT',         label: '🇦🇪 UAE — Passport' },
  { value: 'AE_EMIRATES_ID',      label: '🇦🇪 UAE — Emirates ID' },
  { value: 'CN_PASSPORT',         label: '🇨🇳 China — Passport' },
  { value: 'CN_ID_CARD',          label: '🇨🇳 China — Resident ID' },
  { value: 'COMPANY_REGISTRATION',label: '🏢 Company Registration' },
]

interface Props {
  caseId: string
  onUploaded: (doc: any) => void
}

export default function DocumentUpload({ caseId, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState('')
  const [docType, setDocType]     = useState('')
  const [uploaded, setUploaded]   = useState<any>(null)

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await documentsApi.upload(caseId, file, docType || undefined)
      setUploaded(result)
      onUploaded(result)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [caseId, docType, onUploaded])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/*': [], 'application/pdf': [] }, maxFiles: 1, disabled: uploading,
  })

  return (
    <div>
      {/* Doc type */}
      <div style={{ marginBottom: 12 }}>
        <label className="label">Document Type</label>
        <select className="input" value={docType} onChange={e => setDocType(e.target.value)}>
          {DOC_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Drop zone */}
      {!uploaded ? (
        <div {...getRootProps()} style={{
          border: `2px dashed ${isDragActive ? '#4a7fe8' : '#b8c4de'}`,
          borderRadius: 12, padding: '32px 20px', textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: isDragActive ? '#dce8fc33' : '#f8f9fd',
          transition: 'all 0.2s',
        }}>
          <input {...getInputProps()} />
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Spinner size={28} />
              <div style={{ fontSize: 13, color: '#5a6a84' }}>Uploading & extracting fields…</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e2a3a', marginBottom: 5 }}>
                {isDragActive ? 'Drop here' : 'Click or drag to upload'}
              </div>
              <div style={{ fontSize: 12, color: '#5a6a84', marginBottom: 4 }}>
                Passport · Aadhaar · PAN · National ID · Company Registration
              </div>
              <div style={{ fontSize: 11, color: '#96a3bb' }}>JPG · PNG · PDF · WEBP</div>
            </>
          )}
        </div>
      ) : (
        <UploadResult data={uploaded} onReset={() => setUploaded(null)} />
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fee2e2',
          border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
          {error}
        </div>
      )}
    </div>
  )
}

function UploadResult({ data, onReset }: { data: any; onReset: () => void }) {
  const ext    = data.extraction || {}
  const fields = ext.fields || {}
  const confs  = ext.confidences || {}
  const method = ext.extraction_method || ''

  const methodStyle: Record<string, any> = {
    gemini_vision: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: '✦ Gemini Vision' },
    mrz:           { bg: '#dce8fc', color: '#2563eb', border: '#bdd0f8', label: '⊞ MRZ Parser' },
    tesseract:     { bg: '#fef9c3', color: '#b45309', border: '#fde68a', label: '◈ OCR Fallback' },
  }
  const ms = methodStyle[method] || { bg: '#eef1f8', color: '#5a6a84', border: '#d1d9ee', label: method }

  return (
    <div className="animate-slide-up">
      {/* File info bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>✓</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>{data.filename}</div>
          <div style={{ fontSize: 11, color: '#5a6a84', fontFamily: 'JetBrains Mono,monospace' }}>
            {data.document_type} · {data.country}
          </div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={onReset}>Replace</button>
      </div>

      {/* Badges row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="badge badge-blue">{ext.document_type || data.document_type}</span>
        <span className="badge badge-gray">{ext.country || data.country}</span>
        {ext.issuer && <span className="badge badge-gray" style={{ fontSize: 10 }}>{ext.issuer}</span>}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: ms.bg, color: ms.color, border: `1px solid ${ms.border}`,
          fontFamily: 'JetBrains Mono,monospace',
        }}>{ms.label}</span>
        <span className={`badge ${ext.overall_confidence >= 0.9 ? 'badge-green' : 'badge-amber'}`}>
          {Math.round((ext.overall_confidence || 0.8) * 100)}% confidence
        </span>
      </div>

      {/* Full name */}
      {(ext.full_name || fields.name) && (
        <div style={{ padding: '10px 14px', background: '#dce8fc',
          border: '1px solid #bdd0f8', borderRadius: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#5a6a84', fontFamily: 'JetBrains Mono,monospace', marginBottom: 3 }}>
            EXTRACTED NAME
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e2a3a', fontFamily: 'JetBrains Mono,monospace' }}>
            {ext.full_name || fields.name}
          </div>
        </div>
      )}

      {/* Fields with confidence bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {Object.entries(fields)
          .filter(([k]) => !k.startsWith('_'))
          .slice(0, 8)
          .map(([key, value]) => (
            <div key={key} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono,monospace',
                textTransform: 'uppercase', marginBottom: 2 }}>
                {key.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 12, color: '#1e2a3a', fontFamily: 'JetBrains Mono,monospace',
                wordBreak: 'break-all', marginBottom: 3 }}>
                {String(value)}
              </div>
              {confs[key] > 0 && (
                <div style={{ height: 3, background: '#e4e9f4', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${confs[key] * 100}%`, height: '100%', borderRadius: 2,
                    background: confs[key] >= 0.9 ? '#22c55e' : confs[key] >= 0.7 ? '#f59e0b' : '#ef4444',
                  }} />
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}
