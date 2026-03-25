"""
Document Extraction Service
============================
Real pipeline — reads the ACTUAL uploaded file.

Priority order per upload:
  1. Gemini Vision  → send real image/PDF page to Gemini, get structured JSON
  2. Tesseract OCR  → fallback text extraction from image
  3. pdfminer       → text extraction from searchable PDFs  
  4. MRZ parser     → parse passport machine-readable zone from any text source
  5. Regex parsers  → country/doc-type specific pattern matching

The mock text is only used when ALL of the above fail (e.g. in unit tests
with no real file and no API key).
"""

import re
import io
import json
import base64
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

def _repair_truncated_json(raw: str) -> str:
    """
    Repair JSON cut off mid-stream when the model hit max_tokens.
    Fixes unclosed strings, arrays and objects.
    Returns original string unchanged if it already parses cleanly.
    """
    import json as _json
    try:
        _json.loads(raw)
        return raw
    except Exception:
        pass

    s = raw.strip()

    # Close any open string (odd number of unescaped double-quotes)
    in_string = False
    i = 0
    while i < len(s):
        if s[i] == '\\':
            i += 2
            continue
        if s[i] == '"':
            in_string = not in_string
        i += 1
    if in_string:
        s += '"'

    # Count unclosed braces / brackets
    depth_brace = depth_bracket = 0
    in_str = False
    j = 0
    while j < len(s):
        if s[j] == '\\':
            j += 2
            continue
        if s[j] == '"':
            in_str = not in_str
        if not in_str:
            if   s[j] == '{': depth_brace   += 1
            elif s[j] == '}': depth_brace   -= 1
            elif s[j] == '[': depth_bracket += 1
            elif s[j] == ']': depth_bracket -= 1
        j += 1

    # Strip trailing comma that would invalidate closing
    s = re.sub(r',\s*$', '', s.rstrip())
    s += ']' * max(depth_bracket, 0)
    s += '}' * max(depth_brace,   0)

    try:
        _json.loads(s)
        logger.debug("Repaired truncated JSON successfully")
        return s
    except Exception:
        return raw



# ─── Document Schema Registry ────────────────────────────────────────────────

DOCUMENT_SCHEMAS: Dict[str, Dict] = {
    "IN_PASSPORT": {
        "country": "India", "document_type": "Passport",
        "issuer": "Government of India",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "place_of_birth","date_of_issue","date_of_expiry",
                   "passport_number","place_of_issue"],
        "mrz_supported": True,
    },
    "IN_AADHAAR": {
        "country": "India", "document_type": "Aadhaar Card", "issuer": "UIDAI",
        "fields": ["name","date_of_birth","gender","address","aadhaar_number","vid"],
        "mrz_supported": False,
    },
    "IN_PAN": {
        "country": "India", "document_type": "PAN Card",
        "issuer": "Income Tax Department",
        "fields": ["name","father_name","date_of_birth","pan_number"],
        "mrz_supported": False,
    },
    "IN_VOTER_ID": {
        "country": "India", "document_type": "Voter ID",
        "issuer": "Election Commission of India",
        "fields": ["name","father_name","date_of_birth","gender",
                   "address","epic_number","assembly_constituency"],
        "mrz_supported": False,
    },
    "IN_DRIVING_LICENSE": {
        "country": "India", "document_type": "Driving License",
        "issuer": "Regional Transport Office",
        "fields": ["name","date_of_birth","address","license_number",
                   "date_of_issue","date_of_expiry","vehicle_classes","issuing_authority"],
        "mrz_supported": False,
    },
    "GB_PASSPORT": {
        "country": "United Kingdom", "document_type": "Passport",
        "issuer": "His Majesty's Passport Office",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number","place_of_birth"],
        "mrz_supported": True,
    },
    "GB_DRIVING_LICENSE": {
        "country": "United Kingdom", "document_type": "Driving Licence",
        "issuer": "DVLA",
        "fields": ["surname","given_names","date_of_birth","address",
                   "license_number","date_of_issue","date_of_expiry","vehicle_categories"],
        "mrz_supported": False,
    },
    "US_PASSPORT": {
        "country": "United States", "document_type": "Passport",
        "issuer": "U.S. Department of State",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number","place_of_birth"],
        "mrz_supported": True,
    },
    "US_DRIVERS_LICENSE": {
        "country": "United States", "document_type": "Driver's License",
        "issuer": "State DMV",
        "fields": ["surname","given_names","date_of_birth","address",
                   "license_number","date_of_issue","date_of_expiry","state"],
        "mrz_supported": False,
    },
    "EU_PASSPORT": {
        "country": "European Union", "document_type": "Passport",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number","place_of_birth"],
        "mrz_supported": True,
    },
    "EU_NATIONAL_ID": {
        "country": "European Union", "document_type": "National Identity Card",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","id_number","address"],
        "mrz_supported": True,
    },
    "RU_PASSPORT": {
        "country": "Russia", "document_type": "Passport",
        "issuer": "Ministry of Internal Affairs",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number",
                   "place_of_birth","issuing_department","department_code"],
        "mrz_supported": True,
    },
    "RU_INTERNAL_PASSPORT": {
        "country": "Russia", "document_type": "Internal Passport",
        "fields": ["surname","given_names","date_of_birth","place_of_birth","sex",
                   "series_number","date_of_issue","issuing_authority","registration_address"],
        "mrz_supported": False,
    },
    "AE_PASSPORT": {
        "country": "United Arab Emirates", "document_type": "Passport",
        "issuer": "Federal Authority for Identity and Citizenship",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number"],
        "mrz_supported": True,
    },
    "AE_EMIRATES_ID": {
        "country": "United Arab Emirates", "document_type": "Emirates ID",
        "issuer": "ICA",
        "fields": ["name_arabic","name_english","nationality","date_of_birth",
                   "sex","id_number","date_of_expiry","card_number"],
        "mrz_supported": True,
    },
    "CN_PASSPORT": {
        "country": "China", "document_type": "Passport",
        "issuer": "National Immigration Administration",
        "fields": ["surname","given_names","nationality","date_of_birth","sex",
                   "date_of_issue","date_of_expiry","passport_number","place_of_birth"],
        "mrz_supported": True,
    },
    "CN_ID_CARD": {
        "country": "China", "document_type": "Resident Identity Card",
        "fields": ["name","sex","ethnicity","date_of_birth","address",
                   "id_number","issuing_authority","date_of_issue","date_of_expiry"],
        "mrz_supported": False,
    },
    "COMPANY_REGISTRATION": {
        "country": "Various", "document_type": "Company Registration",
        "fields": ["company_name","registration_number","incorporation_date",
                   "registered_address","directors","company_type","jurisdiction"],
        "mrz_supported": False,
    },
    "BOARDING_PASS": {
        "country": "Various", "document_type": "Boarding Pass",
        "fields": [
            "passenger_name", "flight_number", "airline", "origin", "destination",
            "departure_date", "departure_time", "arrival_time", "seat_number",
            "booking_reference", "class", "gate", "terminal", "frequent_flyer",
            "barcode_data",
        ],
        "mrz_supported": False,
    },
    "GENERIC_DOCUMENT": {
        "country": "Various", "document_type": "Document",
        "fields": ["name", "date", "reference_number", "issuer", "address"],
        "mrz_supported": False,
    },
    "GENERIC_PASSPORT": {
        "country": "Unknown", "document_type": "Passport",
        "fields": ["surname","given_names","nationality","date_of_birth",
                   "sex","date_of_issue","date_of_expiry","passport_number"],
        "mrz_supported": True,
    },
}


# ─── Filename-based document type detection ──────────────────────────────────

def detect_document_type_from_filename(filename: str) -> str:
    fn = filename.lower().replace("-","_").replace(" ","_")

    def has(kw): return kw in fn
    def any_kw(*kws): return any(k in fn for k in kws)

    if any_kw("boarding", "boarding_pass", "boardingpass", "flight_ticket",
               "ticket", "bpass", "eticket", "e_ticket", "airticket"):
        return "BOARDING_PASS"
    if any_kw("company_reg","corp_reg","cert_inc","certificate_of_inc","incorporation","company_registration"):
        return "COMPANY_REGISTRATION"
    if has("company") or has("llc") or (has("ltd") and has("reg")):
        return "COMPANY_REGISTRATION"
    if any_kw("aadhaar","aadhar","uid_card"):
        return "IN_AADHAAR"
    if has("pan") and any_kw("india","indian","income_tax","tax_dept","_in_","pan_card"):
        return "IN_PAN"
    if any_kw("voter_id","epic_card","electors"):
        return "IN_VOTER_ID"
    if any_kw("rto","in_driving","india_driving","indian_driving"):
        return "IN_DRIVING_LICENSE"
    if has("driving") and any_kw("india","_in_","indian"):
        return "IN_DRIVING_LICENSE"
    if any_kw("in_passport","india_passport","indian_passport"):
        return "IN_PASSPORT"
    if any_kw("india","indian") and any_kw("passport","travel_doc"):
        return "IN_PASSPORT"
    if any_kw("emirates_id","eid_card","uae_id","ae_id","emiratesid"):
        return "AE_EMIRATES_ID"
    if has("emirates") and any_kw("id","card"):
        return "AE_EMIRATES_ID"
    if any_kw("ae_passport","uae_passport","emirates_passport"):
        return "AE_PASSPORT"
    if any_kw("uae","_ae_") and any_kw("passport","travel"):
        return "AE_PASSPORT"
    if any_kw("cn_id","china_id","sfz","resident_identity","resident_id_china"):
        return "CN_ID_CARD"
    if has("cn") and any_kw("id_card","resident","identity_card"):
        return "CN_ID_CARD"
    if any_kw("cn_passport","china_passport","prc_passport"):
        return "CN_PASSPORT"
    if any_kw("china","chinese","_cn_","prc") and any_kw("passport","travel"):
        return "CN_PASSPORT"
    if any_kw("ru_internal","russia_internal","vnutrenni"):
        return "RU_INTERNAL_PASSPORT"
    if any_kw("ru_passport","russia_passport","russian_passport"):
        return "RU_PASSPORT"
    if any_kw("russia","russian","_ru_") and any_kw("passport","travel"):
        return "RU_PASSPORT"
    if any_kw("gb_driving","uk_driving","dvla"):
        return "GB_DRIVING_LICENSE"
    if has("driving") and any_kw("uk","gb","britain","british"):
        return "GB_DRIVING_LICENSE"
    if any_kw("gb_passport","uk_passport","british_passport"):
        return "GB_PASSPORT"
    if any_kw("uk","gb","british","britain") and any_kw("passport","travel"):
        return "GB_PASSPORT"
    if any_kw("us_driving","us_driver","dmv"):
        return "US_DRIVERS_LICENSE"
    if has("driving") and any_kw("us","usa","american"):
        return "US_DRIVERS_LICENSE"
    if any_kw("us_passport","usa_passport","american_passport"):
        return "US_PASSPORT"
    if any_kw("eu_national_id","national_id","eu_id_card"):
        return "EU_NATIONAL_ID"
    if any_kw("eu_passport","_eu_passport"):
        return "EU_PASSPORT"
    if any_kw("driving","licence","driver_license","drivers_license"):
        return "GB_DRIVING_LICENSE"
    return "GENERIC_PASSPORT"


# ─── File reading utilities ───────────────────────────────────────────────────

def _read_file(file_path: str) -> Tuple[bytes, str]:
    """Return (raw_bytes, mime_type)."""
    suffix = Path(file_path).suffix.lower()
    with open(file_path, "rb") as f:
        data = f.read()
    mime = {
        ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
        ".png":"image/png",  ".webp":"image/webp",
        ".gif":"image/gif",  ".tiff":"image/tiff", ".tif":"image/tiff",
        ".pdf":"application/pdf",
    }.get(suffix, "image/jpeg")
    return data, mime


def _pdf_first_page_as_image(pdf_bytes: bytes) -> Optional[Tuple[bytes, str]]:
    """Convert first PDF page → PNG bytes for Vision API."""
    try:
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(pdf_bytes, dpi=200, first_page=1, last_page=1)
        if images:
            buf = io.BytesIO()
            images[0].save(buf, format="PNG")
            return buf.getvalue(), "image/png"
    except Exception as e:
        logger.debug(f"pdf2image: {e}")
    return None


def _pdf_extract_text(pdf_bytes: bytes) -> Optional[str]:
    """Extract text from searchable PDF (no OCR needed)."""
    try:
        from pdfminer.high_level import extract_text
        text = extract_text(io.BytesIO(pdf_bytes))
        if text and len(text.strip()) > 20:
            return text.strip()
    except Exception as e:
        logger.debug(f"pdfminer: {e}")
    return None


def _tesseract_ocr(image_bytes: bytes) -> Optional[str]:
    """Run Tesseract on image bytes → raw text string."""
    try:
        import pytesseract
        from PIL import Image, ImageFilter, ImageEnhance
        img = Image.open(io.BytesIO(image_bytes))
        # Pre-process: greyscale + mild sharpening
        img = img.convert("L")
        img = ImageEnhance.Sharpness(img).enhance(2.0)
        # Try multiple psm modes, take longest result
        best = ""
        for psm in ("3", "6", "4"):
            try:
                t = pytesseract.image_to_string(img, config=f"--oem 3 --psm {psm}")
                if len(t.strip()) > len(best.strip()):
                    best = t
            except Exception:
                pass
        return best.strip() if best.strip() else None
    except Exception as e:
        logger.warning(f"Tesseract OCR: {e}")
        return None


# ─── Gemini Vision extraction (primary path) ─────────────────────────────────

async def _gemini_vision_extract(
    image_bytes: bytes,
    mime_type: str,
    schema_key: str,
) -> Optional[Dict[str, Any]]:
    """
    Universal document extraction via Gemini Vision.
    Gemini auto-identifies the document type and extracts every visible field.
    No schema pre-knowledge needed — works for any document.
    """
    from app.core.config import settings
    if not settings.GEMINI_API_KEY:
        return None

    prompt = """You are a KYC compliance document analyst. Your job is to extract only the
fields that are relevant for identity verification and compliance screening.

STEP 1 — Identify the document type.
Determine exactly what this document is. Examples:
Passport, Aadhaar Card, PAN Card, Driving Licence, National ID Card, Voter ID,
Emirates ID, Residence Permit, Visa, Boarding Pass, Bank Statement, Utility Bill,
Company Registration Certificate, Birth Certificate, or any other official document.

STEP 2 — Extract KYC-relevant fields only.
Extract ONLY the fields below that apply to this document type.
Do NOT extract operational details like baggage allowance, seat location,
gate times, transaction histories, tariff rates, or product descriptions —
these have no compliance value.

KYC-relevant fields by document category:

IDENTITY DOCUMENTS (Passport, National ID, Aadhaar, PAN, Driving Licence, Voter ID, Emirates ID):
  surname, given_names, full_name_as_printed, date_of_birth, nationality,
  gender, id_number, document_number, date_of_issue, date_of_expiry,
  place_of_birth, address, issuing_authority, mrz_line1, mrz_line2

TRAVEL DOCUMENTS (Boarding Pass, Visa, Travel Permit):
  passenger_name, date_of_birth (if shown), nationality (if shown),
  passport_number (if shown), travel_document_number,
  origin_country, destination_country, travel_date, visa_type, visa_number

FINANCIAL DOCUMENTS (Bank Statement, Tax Document):
  account_holder_name, address, account_number (last 4 digits only),
  bank_name, statement_period, country_of_account

ADDRESS PROOF (Utility Bill, Council Tax, Insurance):
  customer_name, address, document_date, issuing_organisation

CORPORATE DOCUMENTS (Company Registration, Certificate of Incorporation):
  company_name, registration_number, incorporation_date,
  registered_address, directors, company_type, jurisdiction

Rules:
- Extract ONLY what is clearly visible — never invent or infer
- Preserve exact text as printed (names, numbers, dates in original format)
- For MRZ lines: copy both lines character-for-character exactly as printed
- Omit any field that is not clearly readable

STEP 3 — Identify the primary name for KYC matching.
Set full_name to the person or entity name that would be used for compliance screening.

Return ONLY this JSON — no explanation, no markdown:
{
  "detected_document_type": "exact document type",
  "detected_country": "issuing country",
  "detected_issuer": "issuing authority or organisation",
  "fields": {
    "field_name": "extracted value"
  },
  "confidences": {
    "field_name": 0.95
  },
  "full_name": "name for KYC screening, exactly as printed",
  "mrz_line1": "first MRZ line verbatim if present",
  "mrz_line2": "second MRZ line verbatim if present",
  "document_quality": "good|fair|poor",
  "notes": "expiry status, visible tampering, or other compliance observations"
}"""

    try:
        from app.core.llm_router import llm
        raw = await llm.gemini_vision(
            image_bytes=image_bytes,
            mime_type=mime_type,
            prompt=prompt,
            system="You are a KYC document extraction AI. Return ONLY valid JSON.",
            max_tokens=3000,
        )
        clean = raw.strip()
        if clean.startswith("```"):
            clean = re.sub(r"```[a-z]*\n?", "", clean).strip("`").strip()
        clean = _repair_truncated_json(clean)
        result = json.loads(clean)
        result["_source"] = "gemini_vision"
        detected = result.get("detected_document_type", "Unknown")
        logger.info(f"Gemini Vision: detected '{detected}', extracted {len(result.get('fields',{}))} fields")
        return result
    except Exception as e:
        logger.warning(f"Gemini Vision extraction failed: {e}")
        return None


# ─── MRZ parser ───────────────────────────────────────────────────────────────

def _parse_mrz(text: str) -> Optional[Dict[str, Any]]:
    """Parse ICAO MRZ lines from OCR text."""
    lines = [l.strip() for l in text.splitlines() if re.match(r'^[A-Z0-9<]{30,}$', l.strip())]
    if len(lines) < 2:
        return None
    try:
        line1, line2 = lines[0], lines[1]
        country    = line1[2:5]
        name_raw   = line1[5:44]
        parts      = name_raw.split("<<")
        surname    = parts[0].replace("<", " ").strip()
        given      = " ".join(p.replace("<", " ").strip() for p in parts[1:] if p)
        doc_num    = line2[0:9].replace("<", "")
        nationality = line2[10:13]
        dob_raw    = line2[13:19]
        sex        = line2[20]
        exp_raw    = line2[21:27]

        def fmt_date(d: str) -> str:
            if len(d) != 6: return d
            yy, mm, dd = d[0:2], d[2:4], d[4:6]
            year = f"19{yy}" if int(yy) > 30 else f"20{yy}"
            return f"{dd}/{mm}/{year}"

        return {
            "surname":         surname,
            "given_names":     given,
            "document_number": doc_num,
            "issuing_country": country,
            "nationality":     nationality,
            "date_of_birth":   fmt_date(dob_raw),
            "sex":             sex,
            "date_of_expiry":  fmt_date(exp_raw),
            "_source":         "mrz",
        }
    except Exception as e:
        logger.debug(f"MRZ parse error: {e}")
        return None


# ─── Regex field extractors ───────────────────────────────────────────────────

def _extract_aadhaar(text: str) -> Dict[str, Any]:
    f: Dict[str, Any] = {}
    flat = " ".join(text.split())
    # Aadhaar: 12 consecutive digits (possibly with spaces), grab first match
    m = re.search(r'\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b', flat)
    if m: f["aadhaar_number"] = re.sub(r'[^0-9]', '', m.group(1))
    m = re.search(r'VID\s*:?\s*(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})', flat, re.I)
    if m: f["vid"] = m.group(1).replace(" ", "")
    m = re.search(r'(?:DOB|Date of Birth|D\.O\.B)[:\s]+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})', flat, re.I)
    if m: f["date_of_birth"] = m.group(1)
    m = re.search(r'\b(MALE|FEMALE|TRANSGENDER|Male|Female)\b', flat)
    if m: f["gender"] = m.group(1).upper()
    # Name — stop at noise words / next label
    m = re.search(r'Name[:\s]+([A-Za-z][A-Za-z ]{2,40}?)(?=\s+(?:DOB|Date|Gender|Address|AADHAAR|VID|\d|oe\b|PHOTO))', flat, re.I)
    if not m:
        m = re.search(r'Name[:\s]+([A-Za-z][A-Za-z ]{2,35})', flat, re.I)
    if m:
        raw_name = m.group(1).strip()
        # Remove common OCR artifacts
        raw_name = re.sub(r'\b(oe|PHOTO|IE|amu)\b', '', raw_name, flags=re.I).strip()
        if len(raw_name) > 2:
            f["name"] = _clean(raw_name)
    m = re.search(r'(?:Address)[:\s]+([A-Za-z0-9][^:]{10,80}?)(?=\s+(?:AADHAAR|VID|\d{4}\s\d{4}|$))', flat, re.I)
    if m: f["address"] = _clean(m.group(1))
    # DOB fallback — unlabeled date (Aadhaar often has no "DOB:" label)
    if not f.get("date_of_birth"):
        all_dates = re.findall(r'\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})\b', flat)
        if all_dates:
            f["date_of_birth"] = all_dates[0]
    return f


def _extract_pan(text: str) -> Dict[str, Any]:
    f: Dict[str, Any] = {}
    m = re.search(r'\b([A-Z]{5}[0-9]{4}[A-Z])\b', text)
    if m: f["pan_number"] = m.group(1)
    m = re.search(r'(?:Date of Birth|DOB)[:\s]*(\d{2}[/\-]\d{2}[/\-]\d{4})', text, re.I)
    if m: f["date_of_birth"] = m.group(1)
    # Name — first substantial uppercase line after "Name:"
    m = re.search(r'(?:^|\n)(?:Name|NAME)[:\s]+([A-Z][A-Z\s]{2,40})', text, re.M)
    if m: f["name"] = m.group(1).strip()
    m = re.search(r"(?:Father(?:'s)? Name|FATHER)[:\s]+([A-Z][A-Z\s]{2,40})", text, re.I)
    if m: f["father_name"] = m.group(1).strip()
    return f


def _clean(v: str) -> str:
    """Strip newlines and extra whitespace from an extracted value."""
    return " ".join(v.split()).strip()


def _extract_generic(text: str) -> Dict[str, Any]:
    """Generic passport/ID extractor using regex."""
    f: Dict[str, Any] = {}
    # Replace newlines with spaces so single-line patterns work
    flat = " ".join(text.split())

    # Passport number
    m = re.search(r'(?:Passport\s*(?:No\.?|Number|#|No)[:\s.]*)([A-Z]{0,2}[0-9]{7,9})\b', flat, re.I)
    if m: f["passport_number"] = m.group(1)

    # Dates — look for labelled dates first
    for label, key in [
        (r"(?:Date of Birth|DOB|D\.O\.B)", "date_of_birth"),
        (r"(?:Date of Issue|Issue Date|Issued)",    "date_of_issue"),
        (r"(?:Date of Expiry|Expiry|Valid Until|Expires)", "date_of_expiry"),
    ]:
        m = re.search(label + r"[:\s]+([\d]{1,2}[/\-.]?[\d]{1,2}[/\-.]?[\d]{2,4})", flat, re.I)
        if m: f[key] = m.group(1).replace(".", "/").replace("-", "/")
    # Fallback: take unlabelled dates in order for any missing date fields
    all_dates = re.findall(r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b", flat)
    labels = ["date_of_birth", "date_of_issue", "date_of_expiry"]
    for i, d in enumerate(all_dates[:3]):
        if labels[i] not in f:
            f[labels[i]] = d

    # Names — match until end of "word group" (stop at next label keyword)
    m = re.search(r"(?:Surname|SURNAME|Last\s*Name)[:\s]+([A-Z][A-Z ]{1,30}?)(?=\s+(?:Given|First|National|Date|Sex|Place|Passport|\d))", flat, re.I)
    if m: f["surname"] = _clean(m.group(1))
    else:
        m = re.search(r"(?:Surname|SURNAME)[:\s]+([A-Z][A-Z ]{1,30})", flat, re.I)
        if m: f["surname"] = _clean(m.group(1))

    m = re.search(r"(?:Given\s*Names?|First\s*Name|Forename)[:\s]+([A-Z][A-Z ]{1,40}?)(?=\s+(?:National|Date|Sex|Place|Passport|\d))", flat, re.I)
    if m: f["given_names"] = _clean(m.group(1))
    else:
        m = re.search(r"(?:Given\s*Names?)[:\s]+([A-Z][A-Z ]{1,40})", flat, re.I)
        if m: f["given_names"] = _clean(m.group(1))

    if not f.get("surname") and not f.get("given_names"):
        m = re.search(r"(?:^|\s)(?:Name)[:\s]+([A-Z][A-Z ]{2,40})(?=\s+[A-Z][a-z]|\d|$)", flat, re.M)
        if m: f["full_name"] = _clean(m.group(1))

    # Nationality — stop at next label
    m = re.search(r"(?:Nationality|Nationalité)[:\s]+([A-Z][A-Za-z ]{2,20}?)(?=\s+(?:Date|Sex|Place|Passport|Birth|Issue|Expiry|\d)|$)", flat)
    if m: f["nationality"] = _clean(m.group(1))

    # Sex
    m = re.search(r"\b(?:Sex|Gender)[:\s]*([MF]|MALE|FEMALE)\b", flat, re.I)
    if m: f["sex"] = m.group(1).upper()[0]

    # Place of birth — stop at next label
    m = re.search(r"Place of Birth[:\s]+([A-Z][A-Z ]{2,30}?)(?=\s+(?:Date|Passport|Issue|Expiry|\d)|$)", flat, re.I)
    if m: f["place_of_birth"] = _clean(m.group(1))

    return f


def _extract_boarding_pass(text: str) -> Dict[str, Any]:
    """Extract fields from a boarding pass / flight ticket."""
    f: Dict[str, Any] = {}
    flat = " ".join(text.split())

    # Passenger name — usually the largest text block near top, or after "Name:" / "Passenger:"
    m = re.search(r'(?:Passenger|Name|PASSENGER|BOARDING)[:\s]+([A-Z][A-Z\s/]{3,40}?)(?=\s+(?:Flight|From|To|Gate|Seat|Date|Class|\d{2}[A-Z0-9]))', flat, re.I)
    if m:
        f["passenger_name"] = _clean(m.group(1))
    else:
        # Fallback: look for "SURNAME/FIRSTNAME" or "FIRSTNAME SURNAME" in caps
        m = re.search(r'\b([A-Z]{2,20}/[A-Z]{2,20})\b', flat)
        if m:
            parts = m.group(1).split("/")
            f["passenger_name"] = f"{parts[1]} {parts[0]}".title()
        else:
            # All-caps name block (common on boarding passes)
            m = re.search(r'\b([A-Z]{2,}(?:\s+[A-Z]{2,}){1,3})\b', flat)
            if m:
                candidate = m.group(1)
                # avoid matching flight codes like "AA 123"
                if not re.match(r'^[A-Z]{2}\s+\d', candidate):
                    f["passenger_name"] = candidate.title()

    # Flight number — e.g. AA123, EK 204, BA 0456
    m = re.search(r'\b([A-Z]{2}\s?\d{1,4})\b', flat)
    if m:
        f["flight_number"] = m.group(1).replace(" ", "")

    # Booking / PNR reference — 6 uppercase alphanumeric
    m = re.search(r'\b([A-Z0-9]{6})\b', flat)
    if m:
        f["booking_reference"] = m.group(1)

    # Origin / Destination — 3-letter IATA codes
    iata = re.findall(r'\b([A-Z]{3})\b', flat)
    # Filter out common non-IATA words
    skip = {"THE","AND","FOR","NOT","MR","MRS","MS","DR","PNR","PDF","IMG","OCR"}
    iata_codes = [c for c in iata if c not in skip]
    if len(iata_codes) >= 2:
        f["origin"]      = iata_codes[0]
        f["destination"] = iata_codes[1]

    # Departure date
    m = re.search(r'\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b', flat, re.I)
    if m:
        f["departure_date"] = m.group(1)

    # Departure time
    m = re.search(r'\b(?:Dep(?:arture)?|Departs?|STD)[:\s]*(\d{1,2}:\d{2}(?:\s?[AP]M)?)\b', flat, re.I)
    if not m:
        m = re.search(r'\b(\d{2}:\d{2})\b', flat)
    if m:
        f["departure_time"] = m.group(1)

    # Seat
    m = re.search(r'\b(?:Seat|SEAT)[:\s]*([0-9]{1,3}[A-Z])\b', flat, re.I)
    if not m:
        m = re.search(r'\b(\d{1,3}[A-F])\b', flat)
    if m:
        f["seat_number"] = m.group(1)

    # Gate
    m = re.search(r'\b(?:Gate|GATE)[:\s]*([A-Z0-9]{1,5})\b', flat, re.I)
    if m:
        f["gate"] = m.group(1)

    # Class
    m = re.search(r'\b(?:Class|Cabin|CLASS)[:\s]*(Economy|Business|First|Premium Economy|[A-Z])\b', flat, re.I)
    if m:
        f["class"] = m.group(1)

    # Airline name (common ones)
    airlines = [
        "IndiGo","Air India","SpiceJet","Vistara","GoAir","AirAsia","Emirates",
        "British Airways","Lufthansa","Qatar Airways","Singapore Airlines",
        "United Airlines","American Airlines","Delta","Southwest","Ryanair",
        "EasyJet","Turkish Airlines","Air France","KLM",
    ]
    for airline in airlines:
        if airline.lower() in flat.lower():
            f["airline"] = airline
            break

    # Frequent flyer number
    m = re.search(r'\b(?:FF|Frequent Flyer|Miles|FFN)[:\s#]*([A-Z0-9]{6,12})\b', flat, re.I)
    if m:
        f["frequent_flyer"] = m.group(1)

    return f


def _extract_company(text: str) -> Dict[str, Any]:
    f: Dict[str, Any] = {}
    m = re.search(r'(?:Registration|Company)\s*(?:No\.?|Number)[.:\s]+([A-Z0-9]{5,15})', text, re.I)
    if m: f["registration_number"] = m.group(1)
    m = re.search(r'(?:Incorporated|Date of Incorporation|Formed)[:\s]+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})', text, re.I)
    if m: f["incorporation_date"] = m.group(1)
    m = re.search(r'(?:Company Name|Name of Company)[:\s]+(.{3,80})', text, re.I)
    if m:
        f["company_name"] = m.group(1).strip()
    else:
        lines = [l.strip() for l in text.splitlines() if len(l.strip()) > 5]
        if lines: f["company_name"] = lines[0]
    m = re.search(r'(?:Registered Address|Address)[:\s]+(.{10,120})', text, re.I)
    if m: f["registered_address"] = m.group(1).strip()
    m = re.search(r'(?:Director|Authorised Person)[:\s]+([A-Za-z][A-Za-z\s,]{2,60})', text, re.I)
    if m: f["directors"] = m.group(1).strip()
    return f


# ─── Build confidence scores ──────────────────────────────────────────────────

def _assign_confidence(fields, source="ocr"):

    confidences = {}

    if not fields:
        return {}

    base_scores = {
        "gemini_vision": 0.96,
        "mrz": 0.97,
        "pdfminer": 0.90,
        "tesseract": 0.82,
        "regex": 0.80,
    }

    default_conf = base_scores.get(source, 0.85)

    for field in fields:
        confidences[field] = default_conf

    return confidences

# ─── Assemble final extraction result ────────────────────────────────────────

def _sanitise(v: str) -> str:
    """Remove obvious OCR noise from a field value.
    Preserves numeric-only values (Aadhaar numbers, PAN, doc numbers, etc.)
    Only removes single-character junk lines when value has multiple lines.
    """
    if not v:
        return v
    s = str(v).strip()
    # If single-line (no newlines), return as-is — numeric-only is valid (Aadhaar, IDs)
    if '\n' not in s:
        return s
    # Multi-line: strip lines that are just 1-2 chars (OCR noise)
    lines = [l.strip() for l in s.splitlines() if len(l.strip()) > 2]
    return " ".join(lines).strip()


def _build_result(
    schema_key: str,
    fields: Dict[str, Any],
    confidences: Dict[str, float],
    raw_text: str,
    source: str,
    extra: Optional[Dict] = None,
) -> Dict[str, Any]:
    schema = DOCUMENT_SCHEMAS.get(schema_key, DOCUMENT_SCHEMAS["GENERIC_PASSPORT"])

    # Sanitise all field values
    clean_fields = {
        k: _sanitise(str(v))
        for k, v in fields.items()
        if not k.startswith("_") and v and _sanitise(str(v))
    }

    # Best-effort full name from available fields
    override = fields.get("_full_name_override", "")
    if override:
        full_name = _sanitise(override)
    elif clean_fields.get("full_name"):
        full_name = clean_fields["full_name"]
    elif clean_fields.get("name"):
        full_name = clean_fields["name"]
    elif clean_fields.get("surname") and clean_fields.get("given_names"):
        full_name = f"{clean_fields['given_names']} {clean_fields['surname']}"
    elif clean_fields.get("surname"):
        full_name = clean_fields["surname"]
    else:
        full_name = ""

    overall = round(sum(confidences.values()) / len(confidences), 3) if confidences else 0.5

    result: Dict[str, Any] = {
        "document_schema":     schema_key,
        "document_type":       schema["document_type"],
        "country":             schema["country"],
        "issuer":              schema.get("issuer", ""),
        "full_name":           full_name,
        "fields":              clean_fields,
        "confidences":         confidences,
        "overall_confidence":  overall,
        "extraction_method":   source,
        "raw_text":            raw_text[:3000] if raw_text else "",
    }
    if extra:
        result.update(extra)
    return result

# ─── Main pipeline ────────────────────────────────────────────────────────────

async def extract_document(
    file_path: str,
    filename: str,
    document_type_hint: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Real extraction pipeline.
    Reads the actual file, sends to Gemini Vision first,
    falls back to Tesseract + regex if Vision unavailable.
    """
    schema_key = document_type_hint or detect_document_type_from_filename(filename)
    schema     = DOCUMENT_SCHEMAS.get(schema_key, DOCUMENT_SCHEMAS["GENERIC_PASSPORT"])

    # ── Read file ─────────────────────────────────────────────────────────────
    try:
        file_bytes, mime_type = _read_file(file_path)
    except Exception as e:
        logger.error(f"Cannot read file {file_path}: {e}")
        return _build_result(schema_key, {}, {}, "", "failed")

    # ── Determine image bytes for Vision / OCR ────────────────────────────────
    is_pdf     = mime_type == "application/pdf"
    image_bytes = file_bytes
    image_mime  = mime_type
    raw_text    = ""

    if is_pdf:
        # Try searchable text first (fast, no Vision needed)
        raw_text = _pdf_extract_text(file_bytes) or ""
        # Also get image for Vision
        page_img = _pdf_first_page_as_image(file_bytes)
        if page_img:
            image_bytes, image_mime = page_img

    # ── Path 1: Gemini Vision (primary) ──────────────────────────────────────
    vision_result = await _gemini_vision_extract(image_bytes, image_mime, schema_key)

    if vision_result and vision_result.get("fields"):
        fields      = vision_result["fields"]
        confidences = vision_result.get("confidences", _assign_confidence(fields, "gemini_vision"))
        raw_text    = vision_result.get("raw_text", raw_text)

        # Use Gemini's auto-detected document type instead of the filename guess
        detected_type   = vision_result.get("detected_document_type", "")
        detected_country = vision_result.get("detected_country", "")
        detected_issuer  = vision_result.get("detected_issuer", "")

        # Try to map detected type back to a known schema key for consistency,
        # but always fall back gracefully to a dynamic schema built from what Vision found
        resolved_schema_key = schema_key
        for key, sc in DOCUMENT_SCHEMAS.items():
            if sc["document_type"].lower() == detected_type.lower():
                resolved_schema_key = key
                break

        # Merge in MRZ data (higher confidence) if Vision found MRZ lines
        mrz_text = f"{vision_result.get('mrz_line1','')}\n{vision_result.get('mrz_line2','')}"
        mrz = _parse_mrz(mrz_text) or _parse_mrz(raw_text)
        if mrz:
            for k, v in mrz.items():
                if not k.startswith("_") and v and k not in fields:
                    fields[k] = v
                    confidences[k] = 0.97

        if vision_result.get("full_name"):
            fields["_full_name_override"] = vision_result["full_name"]

        extra = {
            "document_quality": vision_result.get("document_quality", "good"),
            "notes":            vision_result.get("notes", ""),
        }
        conf_avg = sum(confidences.values()) / max(len(confidences), 1)
        logger.info(f"[Vision] {detected_type}: {len(fields)} fields, conf={conf_avg:.2f}")

        # Build result — override document_type/country/issuer with what Vision detected
        result = _build_result(resolved_schema_key, fields, confidences, raw_text, "gemini_vision", extra)
        if detected_type:
            result["document_type"] = detected_type
        if detected_country:
            result["country"] = detected_country
        if detected_issuer:
            result["issuer"] = detected_issuer
        return result

    # ── Path 2: OCR fallback (no Gemini key or Vision failed) ────────────────
    logger.info(f"Gemini Vision unavailable/failed for {filename} — falling back to OCR")

    if not raw_text or len(raw_text) < 30:
        raw_text = _tesseract_ocr(image_bytes) or ""
    ocr_source = "pdfminer" if (is_pdf and _pdf_extract_text(file_bytes)) else "tesseract"

    # ── Path 3: MRZ parser ────────────────────────────────────────────────────
    fields: Dict[str, Any] = {}
    if schema.get("mrz_supported", True) and raw_text:
        mrz = _parse_mrz(raw_text)
        if mrz:
            fields.update({k: v for k, v in mrz.items() if not k.startswith("_")})
            ocr_source = "mrz"

    # ── Path 4: Regex parsers — run known ones, generic catches everything else
    if raw_text:
        if schema_key == "IN_AADHAAR":
            fields.update(_extract_aadhaar(raw_text))
        elif schema_key == "IN_PAN":
            fields.update(_extract_pan(raw_text))
        elif schema_key == "COMPANY_REGISTRATION":
            fields.update(_extract_company(raw_text))
        else:
            # Generic extractor handles passports, IDs, and anything unknown
            fields.update(_extract_generic(raw_text))

    confidences = _assign_confidence(fields, ocr_source)

    logger.info(f"[OCR/{ocr_source}] {schema_key}: {len(fields)} fields extracted")
    return _build_result(schema_key, fields, confidences, raw_text, ocr_source)
