# 🛡 SmartKYC — AI-Powered KYC/AML Compliance Platform

> Automate your entire Know Your Customer pipeline — from document upload to human review decision — using a multi-agent AI architecture.

![Status](https://img.shields.io/badge/status-production--ready-green)
![Python](https://img.shields.io/badge/python-3.12%2B-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688)
![React](https://img.shields.io/badge/React-18-61DAFB)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ What SmartKYC Does

SmartKYC automates the full KYC/AML lifecycle:

1. **Document Extraction** — Gemini Vision reads passports, Aadhaar, PAN, Emirates ID, and 15+ doc types with field-level confidence scoring
2. **AI Investigation Planning** — Claude / Gemini / GPT-4o decides which investigation agents to spawn based on subject risk profile
3. **Multi-Agent Execution** — Sanctions, PEP, Corporate Registry, Adverse Media, and Transaction agents run in sequence with auto-escalation
4. **Human Review Queue** — Risk-ranked cases routed to compliance officers for approve / reject / escalate decisions

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  (React + TypeScript)                             │
│  Dashboard · New Case · Cases · Detail · Review · Authorities│
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────────────┐
│  API LAYER  (FastAPI)                                        │
│  /api/cases  /api/documents  /api/reviews  /api/investigations│
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
┌──────────▼──────────┐    ┌─────────────▼──────────────────┐
│  SERVICES            │    │  AGENTS                         │
│  document_service    │    │  Identity · Sanctions · PEP    │
│  investigation_svc   │    │  Registry · Media · Transactions│
│  verification_svc    │    │  RiskAggregation               │
│  llm_router          │    └────────────────────────────────┘
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│  DATABASE  (SQLite / PostgreSQL via SQLAlchemy)              │
│  Cases · Documents · AgentResults · Reviews · Events        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- [Gemini API key](https://aistudio.google.com) (free tier available)
- Optional: Tesseract OCR (`sudo apt install tesseract-ocr`) for OCR fallback
- Optional: Poppler (`sudo apt install poppler-utils`) for PDF support

### 1. Clone & Install

```bash
git clone https://github.com/your-org/smartkyc.git
cd smartkyc
pip install -r requirements.txt
```

### 2. Configure



Edit `.env` — at minimum set your Gemini key:

```env
GEMINI_API_KEY=your-gemini-api-key
LLM_PROVIDER=gemini
USE_MOCK_VERIFICATION=true   # Use false for real API checks
```

### 3. Start Backend

```bash
uvicorn app.main:app --reload --port 8000
```

API docs available at: http://localhost:8000/docs

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:5173**

---

## 📁 Project Structure

```
smartkyc/
├── app/
│   ├── main.py                  # FastAPI app factory + routers
│   ├── core/
│   │   ├── config.py            # All environment config (Pydantic Settings)
│   │   ├── llm_router.py        # Gemini / Anthropic / OpenAI router
│   │   └── logging.py           # Structured logging setup
│   ├── db/
│   │   ├── models.py            # SQLAlchemy ORM models
│   │   └── session.py           # DB engine + session factory
│   ├── api/
│   │   ├── cases.py             # /api/cases — CRUD + investigation trigger
│   │   ├── documents.py         # /api/documents — upload + extraction
│   │   ├── reviews.py           # /api/reviews — queue + decisions
│   │   ├── investigations.py    # /api/investigations — live status
│   │   └── authorities.py       # /api/authorities — authority catalogue
│   ├── services/
│   │   ├── document_service.py  # Extraction pipeline (Vision → OCR → MRZ → Regex)
│   │   ├── investigation_service.py  # LLM orchestration + agent execution
│   │   └── verification_service.py   # 15 authority definitions + mock/real dispatch
│   └── agents/
│       ├── base_agent.py        # Abstract BaseAgent + AgentResult
│       └── agents.py            # All agent implementations
├── frontend/
│   └── src/pages/
│       ├── DashboardPage.tsx
│       ├── NewCasePage.tsx
│       ├── CasesPage.tsx
│       ├── CaseDetailPage.tsx
│       ├── ReviewQueuePage.tsx
│       └── AuthoritiesPage.tsx
├── requirements.txt
└── .env.example
```

---

## 🤖 Agent System

### Agent Tiers

| Tier | When | Agents |
|------|------|--------|
| **Mandatory** | Always | Identity, Sanctions, Adverse Media |
| **Conditional** | Auto-triggered by subject type | PEP Check (gov/political), Registry Lookup (company/director) |
| **Optional** | LLM-decided at runtime | Transaction Analysis |
| **Escalated** | If any score ≥ 70 | LLM decides from remaining unrun agents |

### Risk Aggregation Weights

```
sanctions_agent       × 0.30
pep_agent             × 0.25
identity_agent        × 0.15
registry_agent        × 0.15
adverse_media_agent   × 0.10
transaction_agent     × 0.05
```

Final score → `low` (<40) / `medium` (<60) / `high` (<80) / `critical` (≥80)

---

## 📄 Document Extraction

Extraction priority chain per upload:

```
1. Gemini Vision    → Structured JSON extraction from image  (~96% confidence)
2. MRZ Parser       → ICAO Machine Readable Zone parsing     (~97% confidence)
3. Tesseract OCR    → Fallback text extraction               (~82% confidence)
4. Regex Parsers    → Country/doc-type specific patterns     (~80% confidence)
```

### Supported Document Types

| Country | Documents |
|---------|-----------|
| 🇮🇳 India | Passport, Aadhaar Card, PAN Card, Voter ID, Driving License |
| 🇬🇧 UK | Passport, Driving Licence |
| 🇺🇸 USA | Passport, Driver's License |
| 🇦🇪 UAE | Passport, Emirates ID |
| 🇷🇺 Russia | Passport, Internal Passport |
| 🇨🇳 China | Passport, Resident Identity Card |
| 🇪🇺 EU | Passport, National Identity Card |
| 🏢 Corporate | Company Registration |

---

## 🌐 Verification Authorities (15 total)

| Category | Authorities |
|----------|-------------|
| **Sanctions** | OFAC SDN, UN Consolidated, EU Financial Sanctions, HM Treasury |
| **PEP** | World-Check One (Refinitiv), LexisNexis WorldCompliance |
| **Registry** | Companies House (UK), OpenCorporates, MCA21 India |
| **Identity** | UIDAI Aadhaar, India PAN, DVLA UK, Passport ICAO |
| **Adverse Media** | Global News API, Dow Jones Risk & Compliance |

All authorities operate in **MOCK mode by default** with realistic test responses. Set `USE_MOCK_VERIFICATION=false` to enable real API calls.

---

## ⚙️ Configuration

Full `.env` reference:

```env
# Database
DATABASE_URL=sqlite+aiosqlite:///./smartkyc.db

# LLM — choose one
LLM_PROVIDER=gemini                          # gemini | anthropic | openai
GEMINI_API_KEY=your-key
ANTHROPIC_API_KEY=your-key
OPENAI_API_KEY=your-key

# Verification
USE_MOCK_VERIFICATION=true
OFAC_API_KEY=
WORLD_CHECK_API_KEY=
COMPANIES_HOUSE_API_KEY=
OPEN_CORPORATES_API_KEY=
LEXISNEXIS_API_KEY=
NEWS_API_KEY=
DOW_JONES_API_KEY=

# Files
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=20

# CORS
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]
```

---

## 🛠 Developer Guide

### Add a New Agent

```python
# 1. Create class in app/agents/agents.py
class MyNewAgent(BaseAgent):
    name = "my_new_agent"
    
    async def run(self) -> AgentResult:
        # ... your logic, call run_verification() ...
        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="...",
            confidence=0.85,
            evidence=evidence,
            authorities_used=authorities,
        )

# 2. Register in investigation_service.py AGENT_CATALOGUE
"my_new_agent": {
    "class": MyNewAgent,
    "display_name": "My New Agent",
    "description": "What this agent checks and why",
    "typical_use": "When this agent should run",
    "tier": "optional",   # mandatory | conditional | optional
}
```

### Add a New Document Schema

```python
# 1. Add to DOCUMENT_SCHEMAS in document_service.py
"ZA_NATIONAL_ID": {
    "country": "South Africa",
    "document_type": "National Identity Document",
    "issuer": "Department of Home Affairs",
    "fields": ["surname", "given_names", "date_of_birth", "id_number", "sex"],
    "mrz_supported": False,
}

# 2. Add filename detection
if any_kw("za_id", "sa_id", "south_africa_id"):
    return "ZA_NATIONAL_ID"
```

### Switch to PostgreSQL

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost/smartkyc
```

---

## 🗄 Database Schema

```
Case ─────────────────────────────────────────────────────────────
  id, case_number, subject_name, subject_type, nationality, DOB
  status, risk_score, risk_level, investigation_plan (JSON)

Document ─────────────────────────────────────────────────────────
  case_id → Case, filename, document_type, extracted_data (JSON)

AgentResult ──────────────────────────────────────────────────────
  case_id → Case, agent_name, risk_score, flags, evidence (JSON)

VerificationSource ───────────────────────────────────────────────
  case_id → Case, source_name, source_type, result, is_mock

HumanReview ──────────────────────────────────────────────────────
  case_id → Case, reviewer_name, decision, comments, risk_override

InvestigationEvent ───────────────────────────────────────────────
  case_id → Case, event_type, event_data (JSON), timestamp
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/cases/` | Create new case |
| `GET` | `/api/cases/` | List all cases (with status filter) |
| `GET` | `/api/cases/dashboard/summary` | Dashboard data with extraction previews |
| `GET` | `/api/cases/{id}` | Full case detail with agents, docs, events |
| `POST` | `/api/cases/{id}/start-investigation` | Launch background investigation |
| `GET` | `/api/cases/{id}/events` | Investigation event log |
| `POST` | `/api/documents/upload/{case_id}` | Upload + extract document |
| `GET` | `/api/documents/{doc_id}/extractions` | Field-level extractions |
| `POST` | `/api/reviews/` | Submit review decision |
| `GET` | `/api/reviews/queue` | Cases pending review (ordered by risk) |
| `GET` | `/api/reviews/history/{case_id}` | Review history |
| `GET` | `/api/investigations/{case_id}/status` | Live investigation status |
| `GET` | `/api/authorities/` | All verification authorities |
| `GET` | `/api/authorities/by-subject` | Authorities for subject profile |

---

## 📋 Case Status Flow

```
pending → investigating → review → cleared
                                 → rejected
                                 → on_hold
                                 → escalated
                                 → pending_documents
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes, including tests
4. Submit a pull request
---

*Built with FastAPI · SQLAlchemy · Google Gemini · React · TypeScript · By Vickey Panjiyar*
