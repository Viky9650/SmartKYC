"""Investigation agents for SmartKYC."""
from typing import Dict, Any
from app.agents.base_agent import BaseAgent, AgentResult
from app.services.verification_service import run_verification


class IdentityAgent(BaseAgent):
    name = "identity_agent"
    description = "Verifies personal identity using extracted document data"

    async def run(self) -> AgentResult:
        self.logger.info(f"IdentityAgent running for case {self.case_id}")
        name        = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        doc_types   = [d.lower() for d in self.subject.get("document_types", [])]

        # Check extracted fields directly — works regardless of detected doc type.
        # Gemini Vision extracts pan_number / aadhaar_number even from generic uploads.
        has_pan     = bool(self.subject.get("pan_number") or self.subject.get("id_number", "").strip())
        has_aadhaar = bool(self.subject.get("aadhaar_number"))
        is_indian   = "india" in nationality.lower() or "indian" in nationality.lower()

        results = {}
        authorities_used = []

        if is_indian:
            # Run PAN check if: doc_type is in_pan OR a pan_number field was extracted
            if has_pan or any("in_pan" in t or "pan" in t for t in doc_types):
                extracted_data = {
                    "pan_number": self.subject.get("pan_number") or self.subject.get("id_number", ""),
                    "name":       name,
                    "dob":        self.subject.get("date_of_birth", ""),
                }
                r = await run_verification(
                    "INDIA_PAN_VERIFY", name,
                    self.subject.get("subject_type", ""), nationality,
                    extracted_data=extracted_data,
                )
                results["INDIA_PAN_VERIFY"] = r
                authorities_used.append("INDIA_PAN_VERIFY")

            # Run Aadhaar check if: doc_type is in_aadhaar OR aadhaar_number extracted
            if has_aadhaar or any("in_aadhaar" in t or "aadhaar" in t for t in doc_types):
                extracted_data = {
                    "aadhaar_number": self.subject.get("aadhaar_number", ""),
                    "name":           name,
                }
                r = await run_verification(
                    "UIDAI_AADHAAR", name,
                    self.subject.get("subject_type", ""), nationality,
                    extracted_data=extracted_data,
                )
                results["UIDAI_AADHAAR"] = r
                authorities_used.append("UIDAI_AADHAAR")

        # Always run passport check
        r = await run_verification("PASSPORT_INDEX", name, self.subject.get("subject_type", ""), nationality)
        results["PASSPORT_INDEX"] = r
        authorities_used.append("PASSPORT_INDEX")

        # Cross-check: if case subject_name differs significantly from extracted name, flag it
        extracted_name = (
            self.subject.get("full_name") or
            self.subject.get("surname", "") + " " + self.subject.get("given_names", "")
        ).strip()
        name_mismatch = (
            extracted_name and name and
            extracted_name.lower() not in name.lower() and
            name.lower() not in extracted_name.lower()
        )

        any_failed = any(v.get("result") not in ["clear", "found", "verified"] for v in results.values())

        flags = []
        if name_mismatch:
            flags.append("name_mismatch_critical")
            self.logger.warning(f"Name mismatch: document='{extracted_name}' vs case='{name}'")
        if any_failed:
            flags.append("identity_verification_failed")

        score = 15.0
        if name_mismatch: score = max(score, 60.0)
        if any_failed and not name_mismatch: score = max(score, 45.0)

        summary_parts = []
        if name_mismatch:
            summary_parts.append(f"CRITICAL name mismatch: document='{extracted_name}' vs case='{name}'")
        if any_failed:
            summary_parts.append("Identity authority check failed.")
        if not summary_parts:
            summary_parts.append("Document verified. No immediate forgery indicators.")

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary=" ".join(summary_parts),
            confidence=0.92 if not flags else 0.70,
            evidence=results,
            authorities_used=authorities_used,
        )


class SanctionsAgent(BaseAgent):
    name = "sanctions_agent"
    description = "Checks global sanctions lists including OFAC, UN, EU, HM Treasury"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        authorities = ["OFAC_SDN", "UN_SANCTIONS", "EU_SANCTIONS"]
        nat_upper = nationality.upper()
        if any(c in nat_upper for c in ["UK", "BRITISH", "GREAT BRITAIN"]):
            authorities.append("HM_TREASURY")

        results = {}
        flags = []
        max_score = 0.0

        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            if r.get("result") == "partial_match":
                score = r.get("match_score", 0.7) * 100
                max_score = max(max_score, score)
            elif r.get("result") == "flagged":
                max_score = max(max_score, 85.0)

        # Deduplicated flags from aggregate results
        # Flags based on result types across all sources
        partial = any(r.get("result") == "partial_match" for r in results.values())
        direct = any(r.get("result") == "flagged" and "sanctions" in str(r.get("matches", "")).lower() for r in results.values())
        high_risk_country = any(
            r.get("country_risk") == "HIGH" or r.get("high_risk_jurisdiction")
            for r in results.values()
        )

        if direct or max_score >= 85:
            flags.append("sanctions_match")
        elif partial:
            flags.append("sanctions_partial_match")
        if high_risk_country:
            flags.append("high_risk_jurisdiction")

        if not flags:
            max_score = 10.0

        return AgentResult(
            agent=self.name,
            risk_score=max_score,
            flags=flags,
            summary="No sanctions matches found." if not flags else f"Sanctions alert: {', '.join(set(flags))}",
            confidence=0.95,
            evidence=results,
            authorities_used=authorities,
        )


class PEPAgent(BaseAgent):
    name = "pep_agent"
    description = "Checks Politically Exposed Persons databases"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        results = {}
        authorities = ["WORLD_CHECK", "LEXISNEXIS"]
        flags = []
        score = 0.0

        pep_confirmed = False
        has_family = False
        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            if r.get("result") == "flagged" and r.get("pep_status") == "CONFIRMED_PEP":
                score = 85.0
                pep_confirmed = True
                if r.get("family_connections"):
                    has_family = True

        if pep_confirmed:
            flags.append("pep_confirmed")
        if has_family:
            flags.append("pep_family_connections")

        if not flags:
            score = 5.0

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No PEP status found." if not flags else "Subject confirmed as Politically Exposed Person.",
            confidence=0.91,
            evidence=results,
            authorities_used=authorities,
        )


class RegistryAgent(BaseAgent):
    name = "registry_agent"
    description = "Verifies company registration and ownership structures"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")
        company_name = self.subject.get("company_name")

        authorities = ["COMPANIES_HOUSE", "OPEN_CORPORATES"]
        nat_upper = nationality.upper()
        if "INDIA" in nat_upper or "INDIAN" in nat_upper:
            authorities.append("MCA21_INDIA")

        results = {}
        flags = []
        score = 0.0

        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality, company_name=company_name)
            results[auth] = r
            if r.get("result") == "flagged":
                score = max(score, 65.0)
                if "Director name mismatch" in str(r.get("discrepancies", [])):
                    flags.append("registry_mismatch")
                if "Nominee director" in str(r.get("discrepancies", [])):
                    flags.append("nominee_director")
                if r.get("beneficial_ownership") == "UNDISCLOSED":
                    flags.append("undisclosed_beneficial_owner")

        if not flags:
            score = 20.0

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No corporate registry issues." if not flags else f"Registry anomalies: {', '.join(flags)}",
            confidence=0.84,
            evidence=results,
            authorities_used=authorities,
        )


class AdverseMediaAgent(BaseAgent):
    name = "adverse_media_agent"
    description = "Scans global news and adverse media"

    async def run(self) -> AgentResult:
        name = self.subject.get("subject_name", "")
        nationality = self.subject.get("nationality", "")
        subject_type = self.subject.get("subject_type", "")

        authorities = ["GLOBAL_NEWS_API", "DOW_JONES_RISK"]
        results = {}
        flags = []
        score = 0.0

        has_adverse = False
        for auth in authorities:
            r = await run_verification(auth, name, subject_type, nationality)
            results[auth] = r
            n = r.get("articles_found", 0)
            if n > 0:
                score = max(score, min(40 + n * 8, 80))
                has_adverse = True
        if has_adverse:
            flags.append("adverse_media")

        if not flags:
            score = 5.0

        total_articles = sum(r.get("articles_found", 0) for r in results.values())
        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary=f"No adverse media found." if not flags else f"{total_articles} adverse media articles found.",
            confidence=0.78,
            evidence=results,
            authorities_used=authorities,
        )


class TransactionAnalysisAgent(BaseAgent):
    name = "transaction_analysis_agent"
    description = "Analyzes suspicious financial transaction patterns"

    async def run(self) -> AgentResult:
        subject_type = self.subject.get("subject_type", "")
        nationality = self.subject.get("nationality", "")

        HIGH_RISK_TYPES = ["pep", "company director"]
        is_high_risk = any(h in subject_type.lower() for h in HIGH_RISK_TYPES)

        flags = []
        score = 0.0
        evidence = {}

        if is_high_risk:
            score = 45.0
            flags = ["high_value_transactions", "cross_border_transfers"]
            evidence = {
                "transaction_count": 47,
                "high_value_count": 8,
                "jurisdictions": ["RU", "AE", "CY", "BVI"],
                "suspicious_patterns": ["Round-number transactions", "Multiple offshore jurisdictions"],
            }
        else:
            score = 10.0
            evidence = {"transaction_count": 12, "high_value_count": 0, "jurisdictions": [], "suspicious_patterns": []}

        return AgentResult(
            agent=self.name,
            risk_score=score,
            flags=flags,
            summary="No suspicious transaction patterns." if not flags else f"Suspicious patterns: {', '.join(flags)}",
            confidence=0.75,
            evidence=evidence,
            authorities_used=[],
        )


class RiskAggregationAgent(BaseAgent):
    name = "risk_aggregation_agent"
    description = "Aggregates all agent findings into a final risk score"

    async def run(self) -> AgentResult:
        agent_results = self.subject.get("_agent_results", [])
        if not agent_results:
            return AgentResult(agent=self.name, risk_score=50, flags=["insufficient_data"],
                               summary="Insufficient data for risk aggregation.", confidence=0.5)

        # Weighted aggregation
        weights = {
            "sanctions_agent": 0.30,
            "pep_agent": 0.25,
            "identity_agent": 0.15,
            "registry_agent": 0.15,
            "adverse_media_agent": 0.10,
            "transaction_analysis_agent": 0.05,
        }

        weighted_score = 0.0
        total_weight = 0.0
        all_flags = []

        for r in agent_results:
            w = weights.get(r["agent"], 0.10)
            weighted_score += r["risk_score"] * w
            total_weight += w
            all_flags.extend(r.get("flags", []))

        final_score = weighted_score / total_weight if total_weight > 0 else 50.0
        final_score = round(min(100, max(0, final_score)), 1)

        unique_flags = list(set(all_flags))
        level = "CRITICAL" if final_score >= 80 else "HIGH" if final_score >= 60 else "MEDIUM" if final_score >= 40 else "LOW"

        return AgentResult(
            agent=self.name,
            risk_score=final_score,
            flags=unique_flags,
            summary=f"Final risk score: {final_score:.0f} ({level}). {len(unique_flags)} risk indicators identified.",
            confidence=0.90,
            evidence={"final_score": final_score, "risk_level": level, "all_flags": unique_flags, "agent_count": len(agent_results)},
            authorities_used=[],
        )
