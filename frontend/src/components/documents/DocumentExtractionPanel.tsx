import { ConfidenceBar, SectionHeader } from '../shared/UI'
import type { DocumentRecord } from '../../types'
import { formatDateTime } from '../../utils'

export default function DocumentExtractionPanel({ documents }: { documents: DocumentRecord[] }) {
  if (!documents?.length) return null

  return (
    <div>
      {documents.map(doc => (
        <DocumentCard key={doc.id} doc={doc} />
      ))}
    </div>
  )
}

function DocumentCard({ doc }: { doc: DocumentRecord }) {
  const ext = doc.extracted_data || {}
  const fields = ext.fields || {}
  const confidences = ext.confidences || {}

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        padding: '10px 14px',
        background: '#eef1f8',
        borderRadius: 8,
        border: '1px solid #d1d9ee',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>
            {doc.document_type?.includes('PASSPORT') ? '🛂' :
             doc.document_type?.includes('AADHAAR') ? '🆔' :
             doc.document_type?.includes('PAN') ? '💳' :
             doc.document_type?.includes('COMPANY') ? '🏢' : '📄'}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>
              {ext.document_type || doc.document_type?.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
              {doc.original_filename} · {ext.country || doc.country_of_issue}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="badge badge-green">
            {Math.round((ext.overall_confidence || 0.85) * 100)}% conf.
          </span>
          <span className="badge badge-gray">{formatDateTime(doc.uploaded_at)}</span>
        </div>
      </div>

      {/* Issuer */}
      {ext.issuer && (
        <div style={{ fontSize: 11, color: '#5a6a84', marginBottom: 10, padding: '0 2px' }}>
          Issued by: <span style={{ color: '#1e2a3a' }}>{ext.issuer}</span>
        </div>
      )}

      {/* Full name highlight */}
      {(ext.full_name || fields.name) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: '#dce8fc44',
          border: '1px solid #3b82f6',
          borderRadius: 8,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, color: '#5a6a84', fontFamily: 'JetBrains Mono, monospace', width: 130, flexShrink: 0 }}>
            FULL NAME
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.03em' }}>
            {ext.full_name || fields.name}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <span className="badge badge-green">Extracted</span>
          </div>
        </div>
      )}

      {/* Fields grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        {Object.entries(fields)
          .filter(([k]) => !k.startsWith('_') && k !== 'name')
          .map(([key, value]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 10,
                color: '#96a3bb',
                fontFamily: 'JetBrains Mono, monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 2,
              }}>{key.replace(/_/g, ' ')}</div>
              <div style={{
                fontSize: 13,
                color: '#1e2a3a',
                fontFamily: 'JetBrains Mono, monospace',
                marginBottom: 3,
                wordBreak: 'break-all',
              }}>{String(value)}</div>
              {confidences[key] !== undefined && (
                <ConfidenceBar value={confidences[key]} />
              )}
            </div>
          ))}
      </div>

      {/* Extraction method */}
      {ext.extraction_method && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
          Extraction method: <span style={{ color: '#5a6a84' }}>{ext.extraction_method}</span>
        </div>
      )}
    </div>
  )
}
