"""
Verification Authority Service

Supports MOCK mode (default, for development/demo) and REAL mode (production APIs).
Set USE_MOCK_VERIFICATION=False in .env to enable real API calls.

Real API integrations scaffold:
- OFAC SDN List (US Treasury)
- UN Consolidated Sanctions
- EU Consolidated Sanctions
- World-Check (Refinitiv/LSEG)
- LexisNexis WorldCompliance
- Companies House (UK)
- OpenCorporates
- UIDAI Aadhaar (India)
- India PAN verification
- UAE ICA
"""

import random
import json
import logging
import httpx
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)


# ─── Authority Definitions ────────────────────────────────────────────────────

VERIFICATION_AUTHORITIES = {
    # SANCTIONS
    "OFAC_SDN": {
        "name": "OFAC SDN List",
        "full_name": "US Treasury OFAC Specially Designated Nationals",
        "type": "sanctions",
        "country": "US",
        "url": "https://sanctionslist.ofac.treas.gov/",
        "real_api_endpoint": "https://api.ofac.treas.gov/v1/sdn/search",
        "api_key_env": "OFAC_API_KEY",
        "description": "US Treasury Office of Foreign Assets Control SDN list",
        "is_free": True,
    },
    "UN_SANCTIONS": {
        "name": "UN Consolidated Sanctions",
        "full_name": "United Nations Security Council Consolidated Sanctions List",
        "type": "sanctions",
        "country": "International",
        "url": "https://www.un.org/securitycouncil/sanctions/information",
        "real_api_endpoint": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "api_key_env": None,
        "description": "UN Security Council sanctions list",
        "is_free": True,
    },
    "EU_SANCTIONS": {
        "name": "EU Consolidated Sanctions",
        "full_name": "European Union Consolidated Sanctions List",
        "type": "sanctions",
        "country": "EU",
        "url": "https://www.eeas.europa.eu/eeas/european-union-sanctions_en",
        "real_api_endpoint": "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content",
        "api_key_env": None,
        "description": "EU Financial Sanctions Database",
        "is_free": True,
    },
    "HM_TREASURY": {
        "name": "HM Treasury Sanctions",
        "full_name": "UK HM Treasury Financial Sanctions",
        "type": "sanctions",
        "country": "UK",
        "url": "https://www.gov.uk/government/publications/financial-sanctions-consolidated-list",
        "real_api_endpoint": "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.json",
        "api_key_env": None,
        "description": "UK Office of Financial Sanctions Implementation",
        "is_free": True,
    },

    # PEP / IDENTITY
    "WORLD_CHECK": {
        "name": "World-Check",
        "full_name": "Refinitiv World-Check One (PEP & Sanctions)",
        "type": "pep",
        "country": "International",
        "url": "https://www.refinitiv.com/en/products/world-check-kyc-screening",
        "real_api_endpoint": "https://rss.refinitiv.com/WORLDCHECK/v2/cases",
        "api_key_env": "WORLD_CHECK_API_KEY",
        "description": "Global PEP and sanctions screening database",
        "is_free": False,
    },
    "LEXISNEXIS": {
        "name": "LexisNexis WorldCompliance",
        "full_name": "LexisNexis WorldCompliance PEP Database",
        "type": "pep",
        "country": "International",
        "url": "https://risk.lexisnexis.com/products/worldcompliance-data",
        "real_api_endpoint": "https://bridger.lexisnexis.com/api/v1/search",
        "api_key_env": "LEXISNEXIS_API_KEY",
        "description": "Comprehensive PEP and adverse media database",
        "is_free": False,
    },

    # CORPORATE REGISTRY
    "COMPANIES_HOUSE": {
        "name": "Companies House",
        "full_name": "UK Companies House Register",
        "type": "registry",
        "country": "UK",
        "url": "https://www.gov.uk/get-information-about-a-company",
        "real_api_endpoint": "https://api.company-information.service.gov.uk/search/companies",
        "api_key_env": "COMPANIES_HOUSE_API_KEY",
        "description": "UK official company registry",
        "is_free": True,  # Free API key available
    },
    "OPEN_CORPORATES": {
        "name": "OpenCorporates",
        "full_name": "OpenCorporates Global Company Registry",
        "type": "registry",
        "country": "International",
        "url": "https://opencorporates.com",
        "real_api_endpoint": "https://api.opencorporates.com/v0.4/companies/search",
        "api_key_env": "OPEN_CORPORATES_API_KEY",
        "description": "Largest open database of companies in the world",
        "is_free": False,
    },
    "MCA21_INDIA": {
        "name": "MCA21 India",
        "full_name": "Ministry of Corporate Affairs - MCA21 Registry",
        "type": "registry",
        "country": "India",
        "url": "https://www.mca.gov.in",
        "real_api_endpoint": "https://www.mca.gov.in/mcafoportal/viewSignatoryDetails.do",
        "api_key_env": None,
        "description": "India Ministry of Corporate Affairs company registry",
        "is_free": True,
    },

    # IDENTITY VERIFICATION
    "UIDAI_AADHAAR": {
        "name": "UIDAI Aadhaar",
        "full_name": "Unique Identification Authority of India - Aadhaar",
        "type": "identity",
        "country": "India",
        "url": "https://uidai.gov.in",
        "real_api_endpoint": "https://resident.uidai.gov.in/web/resident/aadhaar-verification",
        "api_key_env": "UIDAI_API_KEY",
        "description": "India national identity verification",
        "is_free": False,
    },
    "INDIA_PAN_VERIFY": {
        "name": "India PAN Verification",
        "full_name": "Income Tax Department PAN Verification",
        "type": "identity",
        "country": "India",
        "url": "https://www.incometax.gov.in",
        "real_api_endpoint": "https://eservices.incometax.gov.in/pan2/services/panVerificationService",
        "api_key_env": "INDIA_IT_API_KEY",
        "description": "India Income Tax PAN card verification",
        "is_free": True,
    },
    "DVLA_UK": {
        "name": "DVLA Driver Verify",
        "full_name": "UK DVLA Driving Licence Verification",
        "type": "identity",
        "country": "UK",
        "url": "https://www.gov.uk/check-driving-information",
        "real_api_endpoint": "https://driver-vehicle-licensing.api.gov.uk/driving-licences/v1",
        "api_key_env": "DVLA_API_KEY",
        "description": "UK DVLA driving licence verification",
        "is_free": False,
    },
    "PASSPORT_INDEX": {
        "name": "Passport Validation",
        "full_name": "Government Passport Validation Service",
        "type": "identity",
        "country": "International",
        "url": "https://www.icao.int",
        "real_api_endpoint": None,
        "api_key_env": None,
        "description": "ICAO passport chip/MRZ validation",
        "is_free": False,
    },

    # ADVERSE MEDIA
    "GLOBAL_NEWS_API": {
        "name": "Global News Intelligence",
        "full_name": "Global News Intelligence API (Adverse Media)",
        "type": "adverse_media",
        "country": "International",
        "url": "https://newsapi.org",
        "real_api_endpoint": "https://newsapi.org/v2/everything",
        "api_key_env": "NEWS_API_KEY",
        "description": "Global news and adverse media screening",
        "is_free": False,
    },
    "DOW_JONES_RISK": {
        "name": "Dow Jones Risk & Compliance",
        "full_name": "Dow Jones Risk & Compliance Adverse Media",
        "type": "adverse_media",
        "country": "International",
        "url": "https://www.dowjones.com/professional/risk",
        "real_api_endpoint": "https://api.dowjones.com/v1/screening",
        "api_key_env": "DOW_JONES_API_KEY",
        "description": "Professional adverse media and risk intelligence",
        "is_free": False,
    },
}


def get_authorities_for_subject(subject_type: str, nationality: str, document_types: List[str]) -> List[str]:
    """Select relevant verification authorities based on subject profile."""
    authorities = ["OFAC_SDN", "UN_SANCTIONS", "EU_SANCTIONS", "GLOBAL_NEWS_API"]

    nat_upper = (nationality or "").upper()

    # Nationality-specific
    if "INDIA" in nat_upper or "INDIAN" in nat_upper:
        authorities += ["UIDAI_AADHAAR", "INDIA_PAN_VERIFY", "MCA21_INDIA"]
    if "UK" in nat_upper or "BRITISH" in nat_upper or "GREAT BRITAIN" in nat_upper:
        authorities += ["HM_TREASURY", "COMPANIES_HOUSE", "DVLA_UK"]
    if "RUSSIA" in nat_upper or "RUSSIAN" in nat_upper:
        authorities += ["HM_TREASURY", "WORLD_CHECK"]
    if "UAE" in nat_upper or "EMIRATI" in nat_upper:
        authorities += ["WORLD_CHECK"]
    if "CHINA" in nat_upper or "CHINESE" in nat_upper:
        authorities += ["WORLD_CHECK", "OPEN_CORPORATES"]
    if "US" in nat_upper or "AMERICAN" in nat_upper:
        authorities += ["PASSPORT_INDEX"]

    # Subject type specific
    if subject_type in ["pep", "PEP (Politically Exposed Person)"]:
        if "WORLD_CHECK" not in authorities:
            authorities.append("WORLD_CHECK")
        if "LEXISNEXIS" not in authorities:
            authorities.append("LEXISNEXIS")
    if subject_type in ["company_director", "corporate", "Company Director", "Corporate Entity"]:
        if "COMPANIES_HOUSE" not in authorities:
            authorities.append("COMPANIES_HOUSE")
        if "OPEN_CORPORATES" not in authorities:
            authorities.append("OPEN_CORPORATES")
        if "DOW_JONES_RISK" not in authorities:
            authorities.append("DOW_JONES_RISK")

    # Document-based
    if any("aadhaar" in dt.lower() for dt in document_types):
        if "UIDAI_AADHAAR" not in authorities:
            authorities.append("UIDAI_AADHAAR")
    if any("pan" in dt.lower() for dt in document_types):
        if "INDIA_PAN_VERIFY" not in authorities:
            authorities.append("INDIA_PAN_VERIFY")

    return list(dict.fromkeys(authorities))  # dedupe preserving order


# ─── Mock Verification ────────────────────────────────────────────────────────

def _mock_sanctions_check(authority_key: str, subject_name: str, nationality: str) -> Dict[str, Any]:
    """Realistic mock sanctions check."""
    HIGH_RISK_PATTERNS = ["petrov", "morozov", "kim", "al-farsi"]
    name_lower = subject_name.lower()
    is_flagged = any(p in name_lower for p in HIGH_RISK_PATTERNS)
    nat_upper = (nationality or "").upper()
    is_high_risk_country = any(c in nat_upper for c in ["RUSSIA", "IRAN", "NORTH KOREA", "SYRIA", "MYANMAR"])

    if is_flagged and is_high_risk_country:
        return {
            "result": "partial_match",
            "match_score": round(random.uniform(0.70, 0.85), 2),
            "matches": [{
                "name": subject_name,
                "list": authority_key,
                "match_type": "name_similarity",
                "score": round(random.uniform(0.70, 0.85), 2),
                "note": "Partial name match — different date of birth recorded. Manual review required.",
            }],
            "country_risk": "HIGH",
            "high_risk_jurisdiction": nationality,
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    elif is_flagged:
        return {
            "result": "partial_match",
            "match_score": round(random.uniform(0.70, 0.85), 2),
            "matches": [{
                "name": subject_name,
                "list": authority_key,
                "match_type": "name_similarity",
                "score": round(random.uniform(0.70, 0.85), 2),
                "note": "Partial name match — different date of birth recorded. Manual review required.",
            }],
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    elif is_high_risk_country:
        return {
            "result": "flagged",
            "match_score": 0.0,
            "matches": [],
            "country_risk": "HIGH",
            "high_risk_jurisdiction": nationality,
            "note": f"High-risk jurisdiction: {nationality}",
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    else:
        return {
            "result": "clear",
            "match_score": 0.0,
            "matches": [],
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }


def _mock_pep_check(subject_name: str, subject_type: str) -> Dict[str, Any]:
    is_pep = "pep" in subject_type.lower() or "political" in subject_type.lower()
    HIGH_PROFILE = ["al-farsi", "petrov", "morozov", "zhang"]
    name_lower = subject_name.lower()
    is_high_profile = any(p in name_lower for p in HIGH_PROFILE)

    if is_pep or is_high_profile:
        return {
            "result": "flagged",
            "pep_status": "CONFIRMED_PEP",
            "pep_category": "Class 1 - Senior Government Official",
            "roles": [
                {"title": "Former Director General", "organisation": "Government Ministry", "country": "Unknown", "from": "2010", "to": "2020"}
            ],
            "family_connections": ["Spouse: linked to state-owned enterprise"],
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    return {
        "result": "clear",
        "pep_status": "NOT_PEP",
        "checked_at": datetime.utcnow().isoformat(),
        "is_mock": True,
    }


def _mock_identity_check(authority_key: str, extracted_data: Dict) -> Dict[str, Any]:
    """
    Mock identity check that validates against the ACTUAL extracted fields.
    Returns clear when required fields are present, flagged when missing.
    """
    confidence = round(random.uniform(0.88, 0.99), 2)

    if authority_key == "INDIA_PAN_VERIFY":
        pan   = extracted_data.get("pan_number") or extracted_data.get("id_number", "")
        name  = extracted_data.get("name") or extracted_data.get("subject_name", "")
        dob   = extracted_data.get("dob") or extracted_data.get("date_of_birth", "")
        missing = []
        if not pan:  missing.append("PAN Number")
        if not dob:  missing.append("Date of Birth")
        if missing:
            return {
                "result": "flagged",
                "verified": False,
                "confidence": 0.5,
                "failed_fields": {f: "not extracted" for f in missing},
                "checked_at": datetime.utcnow().isoformat(),
                "is_mock": True,
            }
        return {
            "result": "clear",
            "verified": True,
            "confidence": confidence,
            "pan_number": pan,
            "name_on_record": name,
            "dob_on_record": dob,
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }

    if authority_key == "UIDAI_AADHAAR":
        aadhaar = extracted_data.get("aadhaar_number", "")
        name    = extracted_data.get("name") or extracted_data.get("subject_name", "")
        if not aadhaar:
            return {
                "result": "flagged",
                "verified": False,
                "confidence": 0.5,
                "failed_fields": {"Aadhaar Number": "not extracted", "Name": "not found" if not name else "ok"},
                "checked_at": datetime.utcnow().isoformat(),
                "is_mock": True,
            }
        return {
            "result": "clear",
            "verified": True,
            "confidence": confidence,
            "aadhaar_number": aadhaar,
            "name_on_record": name,
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }

    # Generic identity check (passport, DVLA, etc.)
    return {
        "result": "clear",
        "verified": True,
        "confidence": confidence,
        "document_genuine": True,
        "biometric_match": confidence > 0.90,
        "checked_at": datetime.utcnow().isoformat(),
        "is_mock": True,
    }


def _mock_registry_check(authority_key: str, subject_name: str, company_name: Optional[str]) -> Dict[str, Any]:
    MISMATCH_PATTERNS = ["holdings", "tech holdings", "offshore"]
    name_lower = (company_name or subject_name).lower()
    has_mismatch = any(p in name_lower for p in MISMATCH_PATTERNS)

    if has_mismatch:
        return {
            "result": "flagged",
            "found": True,
            "discrepancies": ["Director name mismatch", "Nominee director identified"],
            "companies_found": [
                {"name": company_name or subject_name, "status": "Active", "type": "Private Limited", "jurisdiction": "BVI"}
            ],
            "beneficial_ownership": "UNDISCLOSED",
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    return {
        "result": "clear",
        "found": True,
        "companies_found": [],
        "checked_at": datetime.utcnow().isoformat(),
        "is_mock": True,
    }


def _mock_adverse_media_check(subject_name: str) -> Dict[str, Any]:
    HIGH_RISK_NAMES = ["petrov", "morozov", "al-farsi", "zhang"]
    name_lower = subject_name.lower()
    has_hits = any(p in name_lower for p in HIGH_RISK_NAMES)

    if has_hits:
        return {
            "result": "flagged",
            "articles_found": random.randint(2, 6),
            "articles": [
                {"title": f"Investigation into {subject_name} financial dealings", "source": "Reuters", "date": "2023-08-14", "sentiment": "negative"},
                {"title": f"Regulatory probe: {subject_name} named in report", "source": "Financial Times", "date": "2022-11-03", "sentiment": "negative"},
            ],
            "checked_at": datetime.utcnow().isoformat(),
            "is_mock": True,
        }
    return {
        "result": "clear",
        "articles_found": 0,
        "articles": [],
        "checked_at": datetime.utcnow().isoformat(),
        "is_mock": True,
    }


async def run_verification(
    authority_key: str,
    subject_name: str,
    subject_type: str,
    nationality: str,
    extracted_data: Optional[Dict] = None,
    company_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a single verification authority check (mock or real)."""
    authority = VERIFICATION_AUTHORITIES.get(authority_key)
    if not authority:
        return {"result": "error", "error": f"Unknown authority: {authority_key}"}

    if settings.USE_MOCK_VERIFICATION:
        return await _run_mock(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name)
    else:
        return await _run_real(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name)


async def _run_mock(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name):
    """Run mock verification with realistic results."""
    atype = authority["type"]
    if atype == "sanctions":
        result = _mock_sanctions_check(authority_key, subject_name, nationality)
    elif atype == "pep":
        result = _mock_pep_check(subject_name, subject_type)
    elif atype == "identity":
        result = _mock_identity_check(authority_key, extracted_data or {})
    elif atype == "registry":
        result = _mock_registry_check(authority_key, subject_name, company_name)
    elif atype == "adverse_media":
        result = _mock_adverse_media_check(subject_name)
    else:
        result = {"result": "clear", "is_mock": True}

    result["authority_key"] = authority_key
    result["authority_name"] = authority["name"]
    result["mode"] = "MOCK"
    return result


async def _run_real(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name):
    """
    Real API verification scaffold.
    Each block shows the real API call structure for production use.
    """
    api_key_env = authority.get("api_key_env")
    api_key = getattr(settings, api_key_env, "") if api_key_env else ""
    endpoint = authority.get("real_api_endpoint")

    if not api_key and not authority.get("is_free"):
        logger.warning(f"No API key for {authority_key}, falling back to mock")
        return await _run_mock(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name)

    try:
        if authority_key == "OFAC_SDN":
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    endpoint,
                    params={"name": subject_name, "type": "Individual"},
                    headers={"API-Key": api_key} if api_key else {},
                )
                data = resp.json()
                return {"result": "clear" if not data.get("matches") else "flagged", "data": data, "is_mock": False}

        elif authority_key == "COMPANIES_HOUSE":
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    endpoint,
                    params={"q": subject_name},
                    auth=(api_key, "") if api_key else None,
                )
                data = resp.json()
                return {"result": "clear" if not data.get("items") else "found", "data": data, "is_mock": False}

        elif authority_key == "WORLD_CHECK":
            # Refinitiv World-Check One API
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Basic {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"name": subject_name, "caseSystemId": f"SMARTKYC-{subject_name[:10]}"},
                )
                data = resp.json()
                return {"result": "clear" if not data.get("hits") else "flagged", "data": data, "is_mock": False}

        else:
            # Generic REST call for other authorities
            async with httpx.AsyncClient(timeout=30) as client:
                params = {"name": subject_name, "country": nationality}
                if api_key:
                    params["apiKey"] = api_key
                resp = await client.get(endpoint, params=params)
                data = resp.json()
                return {"result": "clear", "data": data, "is_mock": False}

    except Exception as e:
        logger.error(f"Real API call failed for {authority_key}: {e}")
        logger.info(f"Falling back to mock for {authority_key}")
        return await _run_mock(authority_key, authority, subject_name, subject_type, nationality, extracted_data, company_name)
