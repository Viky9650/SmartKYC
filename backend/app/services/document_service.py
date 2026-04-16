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
    """Run Tesseract on image bytes → raw text string.

    Uses multiple PSM modes and also runs a dedicated MRZ pass (psm 6 with
    the ocrb charlist) so passport machine-readable zones are captured even
    when the rest of the page is complex.
    """
    try:
        import pytesseract
        from PIL import Image, ImageFilter, ImageEnhance
        img = Image.open(io.BytesIO(image_bytes))

        # Resize very large images — Tesseract struggles above ~3000px wide
        w, h = img.size
        MAX_DIM = 2800
        if max(w, h) > MAX_DIM:
            scale = MAX_DIM / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            logger.debug(f"Tesseract: resized image from {w}x{h} to {img.size}")

        # Pre-process: greyscale + mild sharpening
        img = img.convert("L")
        img = ImageEnhance.Sharpness(img).enhance(2.0)

        results: list[str] = []

        # Standard multi-psm pass
        for psm in ("3", "6", "4"):
            try:
                t = pytesseract.image_to_string(img, config=f"--oem 3 --psm {psm}")
                if t.strip():
                    results.append(t.strip())
            except Exception as psm_err:
                logger.debug(f"Tesseract PSM {psm} error: {psm_err}")

        # Dedicated MRZ pass — psm 6 (uniform block), whitelist A-Z 0-9 <
        try:
            mrz_cfg = "--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
            t = pytesseract.image_to_string(img, config=mrz_cfg)
            if t.strip():
                results.append(t.strip())
        except Exception as mrz_err:
            logger.debug(f"Tesseract MRZ pass error: {mrz_err}")

        if not results:
            logger.debug(f"Tesseract: all PSM passes returned empty (image size={img.size})")
            return None

        # Concatenate ALL passes separated by newlines.
        # This ensures _parse_mrz can find the clean MRZ lines produced by
        # the whitelist pass even when the noisy standard pass is also present.
        combined = "\n".join(results)
        logger.debug(f"Tesseract: extracted {len(combined)} chars across {len(results)} PSM passes")
        return combined
    except Exception as e:
        logger.warning(f"Tesseract OCR failed: {e}")
        return None


# ─── Gemini Vision extraction (primary path) ─────────────────────────────────

async def _gemini_vision_extract(
    image_bytes: bytes,
    mime_type: str,
    schema_key: str,
) -> Optional[Dict[str, Any]]:
    """
    Send the actual document image to Gemini Vision.
    Returns structured extraction result or None on failure.
    """
    from app.core.config import settings
    if not settings.GEMINI_API_KEY:
        logger.warning(f"[Vision] GEMINI_API_KEY not set — skipping Vision for {schema_key}")
        return None
    logger.debug(f"[Vision] Calling Gemini Vision for {schema_key} ({mime_type}, {len(image_bytes)} bytes)")

    schema    = DOCUMENT_SCHEMAS.get(schema_key, DOCUMENT_SCHEMAS["GENERIC_PASSPORT"])
    doc_type  = schema["document_type"]
    country   = schema["country"]
    fields    = schema["fields"]

    prompt = f"""You are a document intelligence expert performing KYC extraction.

Document type: {doc_type} from {country}
Expected fields: {fields}

Look at this document image carefully and extract ALL visible fields.

Rules:
- Extract ONLY what is clearly printed/visible on the document
- Do NOT invent, guess or infer any values
- Preserve exact original text (dates, numbers, names as printed)
- For passports: also extract the two MRZ lines at the bottom
- Rate confidence per field: 0.99 = crystal clear, 0.7 = partially obscured
- If you cannot read a field, omit it entirely

Return ONLY this JSON (no markdown, no extra text):
{{
  "fields": {{
    "surname": "...",
    "given_names": "...",
    "date_of_birth": "DD MMM YYYY",
    "date_of_expiry": "DD MMM YYYY",
    "date_of_issue": "DD MMM YYYY",
    "passport_number": "...",
    "nationality": "...",
    "sex": "M or F",
    "place_of_birth": "..."
  }},
  "confidences": {{
    "field_name": 0.95
  }},
  "full_name": "SURNAME GIVEN NAMES exactly as printed",
  "mrz_line1": "P<USACARTER<<EMILY<ANN<<<<<<<<<<<<<<<<<<<<<",
  "mrz_line2": "1234567890USA8502215F2502283<<<<<<<<<<<<<<<4",
  "document_quality": "good"
}}"""

    try:
        from app.core.llm_router import llm
        raw = await llm.gemini_vision(
            image_bytes=image_bytes,
            mime_type=mime_type,
            prompt=prompt,
            system="You are a KYC document extraction AI. Return ONLY valid JSON. No markdown fences. No raw_text field.",
            max_tokens=4000,
        )
        # Strip markdown fences if present
        clean = raw.strip()
        if clean.startswith("```"):
            clean = re.sub(r"```[a-z]*\n?", "", clean).strip("`").strip()

        # Try full parse first; if truncated, attempt partial recovery
        result = None
        try:
            result = json.loads(clean)
        except json.JSONDecodeError as je:
            logger.warning(f"[Vision] JSON parse failed ({je}), attempting partial recovery")
            # Truncate at last complete top-level key boundary and close the object
            # Strategy: find the last comma-or-{ before a complete "key": value pair
            recovered = _recover_partial_json(clean)
            if recovered:
                result = recovered
        if result is None:
            raise ValueError("Could not parse Gemini response as JSON")

        result["_source"] = "gemini_vision"
        logger.info(f"Gemini Vision extracted {len(result.get('fields',{}))} fields from {schema_key}")
        return result
    except Exception as e:
        logger.warning(f"[Vision] Gemini Vision extraction failed for {schema_key}: {type(e).__name__}: {e}")
        return None


def _recover_partial_json(text: str) -> Optional[Dict]:
    """Try to salvage useful fields from a truncated JSON string."""
    # Extract "fields" block using regex even if outer JSON is truncated
    result: Dict[str, Any] = {}

    # Try to find the fields object
    m = re.search(r'"fields"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\})', text, re.DOTALL)
    if m:
        try:
            result["fields"] = json.loads(m.group(1))
        except Exception:
            # Parse key-value pairs manually from the fields block
            fields: Dict[str, str] = {}
            for km in re.finditer(r'"(\w+)"\s*:\s*"([^"]*)"', m.group(1)):
                fields[km.group(1)] = km.group(2)
            if fields:
                result["fields"] = fields

    # Extract scalar top-level keys
    for key in ("full_name", "mrz_line1", "mrz_line2", "document_quality"):
        km = re.search(rf'"{key}"\s*:\s*"([^"]*)"', text)
        if km:
            result[key] = km.group(1)

    # Extract confidences
    m2 = re.search(r'"confidences"\s*:\s*(\{[^{}]*\})', text, re.DOTALL)
    if m2:
        try:
            result["confidences"] = json.loads(m2.group(1))
        except Exception:
            pass

    return result if result.get("fields") else None


# ─── MRZ parser ───────────────────────────────────────────────────────────────

def _parse_mrz(text: str) -> Optional[Dict[str, Any]]:
    """Parse ICAO TD3 MRZ (passport) lines from OCR text.

    Strategy:
    1. Collect all lines that look like MRZ after cleaning.
    2. Prefer a proper TD3 pair: line1 starts with 'P' and is 44 chars,
       line2 is 44 chars starting with an alphanumeric — these are unique
       signatures of a passport MRZ that distinguish it from OCR noise.
    3. Fall back to the first two long-enough candidates if no TD3 pair found.
    """
    def _clean_mrz_line(raw: str) -> str:
        s = raw.upper().replace(" ", "")
        return s

    candidate_lines = []
    for raw_line in text.splitlines():
        cleaned = _clean_mrz_line(raw_line.strip())
        if len(cleaned) >= 30 and re.match(r'^[A-Z0-9<]{30,}$', cleaned):
            candidate_lines.append(cleaned)
        elif len(cleaned) >= 30:
            noise = len(re.findall(r'[^A-Z0-9<]', cleaned))
            if noise <= 2:
                candidate_lines.append(re.sub(r'[^A-Z0-9<]', '<', cleaned))

    if len(candidate_lines) < 2:
        return None

    # ── Prefer a proper TD3 pair ──────────────────────────────────────────────
    # TD3 line1: starts with P + letter/< and is 44 chars
    # TD3 line2: 44 chars, starts with alphanumeric (doc number)
    line1, line2 = None, None
    for i, l in enumerate(candidate_lines):
        # TD3 line1: 'P' + country letter/filler, 43–46 chars (OCR can add ±1)
        if 43 <= len(l) <= 46 and l[0] == 'P' and l[1] in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ<':
            # Look for a matching line2 nearby (same length range, starts with alnum)
            for j in range(i + 1, min(i + 5, len(candidate_lines))):
                cand2 = candidate_lines[j]
                if 42 <= len(cand2) <= 46 and re.match(r'^[A-Z0-9]', cand2):
                    line1, line2 = l, cand2
                    break
        if line1:
            break

    # Fall back to first two candidates
    if not line1:
        line1, line2 = candidate_lines[0], candidate_lines[1]

    try:
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
            try:
                yi, mi, di = int(yy), int(mm), int(dd)
                if not (1 <= mi <= 12 and 1 <= di <= 31):
                    return d
                year = f"19{yy}" if yi > 30 else f"20{yy}"
                return f"{dd}/{mm}/{year}"
            except ValueError:
                return d  # return raw if OCR noise makes it unparseable

        # Sanitize OCR-noisy fields
        # Sex must be M/F/X — anything else is OCR noise
        sex_clean = sex if sex in ("M", "F", "X") else ""
        # Country code from line1 (P<USA...) is more reliably read
        cty_clean = country if re.match(r'^[A-Z]{3}$', country) else re.sub(r'[^A-Z]', '', country)[:3]
        # Nationality must be 3 uppercase letters; fall back to issuing country when OCR mangles it
        nat_raw = re.sub(r'[^A-Z]', '', nationality)
        nat_clean = nat_raw if len(nat_raw) == 3 else cty_clean

        return {
            "surname":         surname,
            "given_names":     given,
            "document_number": doc_num,
            "issuing_country": cty_clean,
            "nationality":     nat_clean,
            "date_of_birth":   fmt_date(dob_raw),
            "sex":             sex_clean,
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

        # Also run MRZ parser if Vision gave us MRZ lines
        mrz_text = f"{vision_result.get('mrz_line1','')}\n{vision_result.get('mrz_line2','')}"
        mrz = _parse_mrz(mrz_text) or _parse_mrz(raw_text)
        if mrz:
            # Merge MRZ data — higher confidence
            for k, v in mrz.items():
                if not k.startswith("_") and v and k not in fields:
                    fields[k] = v
                    confidences[k] = 0.97

        extra = {
            "document_quality": vision_result.get("document_quality", "good"),
            "notes":            vision_result.get("notes", ""),
        }
        if not vision_result.get("full_name") and vision_result.get("fields"):
            # Let _build_result compute full_name from fields
            pass
        if vision_result.get("full_name"):
            fields["_full_name_override"] = vision_result["full_name"]

        logger.info(f"[Vision] {schema_key}: {len(fields)} fields, conf={sum(confidences.values())/max(len(confidences),1):.2f}")
        return _build_result(schema_key, fields, confidences, raw_text, "gemini_vision", extra)

    # ── Path 2: OCR fallback ──────────────────────────────────────────────────
    logger.info(f"Gemini Vision unavailable/failed for {filename} — falling back to OCR")

    # Run Tesseract if we don't have text yet
    if not raw_text or len(raw_text) < 30:
        raw_text = _tesseract_ocr(image_bytes) or ""
    ocr_source = "pdfminer" if (is_pdf and _pdf_extract_text(file_bytes)) else "tesseract"

    # ── Path 3: MRZ parser ────────────────────────────────────────────────────
    fields: Dict[str, Any] = {}
    if schema.get("mrz_supported") and raw_text:
        mrz = _parse_mrz(raw_text)
        if mrz:
            fields.update({k: v for k, v in mrz.items() if not k.startswith("_")})
            ocr_source = "mrz"

    # ── Path 4: Regex parsers ─────────────────────────────────────────────────
    if raw_text:
        if schema_key == "IN_AADHAAR":
            fields.update(_extract_aadhaar(raw_text))
        elif schema_key == "IN_PAN":
            fields.update(_extract_pan(raw_text))
        elif schema_key == "COMPANY_REGISTRATION":
            fields.update(_extract_company(raw_text))
        else:
            fields.update(_extract_generic(raw_text))

    confidences = _assign_confidence(fields, ocr_source)

    if not fields:
        logger.warning(
            f"[OCR/{ocr_source}] {schema_key}: 0 fields extracted. "
            f"raw_text length={len(raw_text)}. "
            f"Tip: ensure Gemini Vision key is set for better extraction."
        )
    else:
        logger.info(f"[OCR/{ocr_source}] {schema_key}: {len(fields)} fields extracted")
    return _build_result(schema_key, fields, confidences, raw_text, ocr_source)
