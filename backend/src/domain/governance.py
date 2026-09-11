from models.schemas import RiskAssessmentRequest


def assess_risk(request: RiskAssessmentRequest) -> dict[str, object]:
    data = impact = exposure = regulatory = 0
    reasons: list[str] = []
    controls: list[str] = []
    reviewers = {"Business owner", "AI Governance"}

    if request.personal == "yes":
        data += 35
        reviewers.add("Privacy")
        reasons.append("Personal information will be processed")
    if request.health == "yes":
        data += 55
        regulatory += 40
        reviewers.update(("Privacy", "Health Care Compliance"))
        reasons.append("Patient or health information is in scope")
    if request.employee == "yes":
        data += 25
        reviewers.add("Privacy")
        reasons.append("Employee information will be processed")
    if request.confidential == "yes":
        data += 25
        reviewers.add("Information Security")
        reasons.append("Confidential J&J information will be used")
    if request.regulated == "yes":
        data += 30
        regulatory += 45
        reviewers.add("MedTech Quality")
        reasons.append("Regulated quality or clinical data is in scope")
    if request.identifiable == "yes" and (request.personal == "yes" or request.health == "yes"):
        data += 20
        reasons.append("Sensitive information may be directly identifiable")
    if request.model_training == "yes":
        data += 25
        reviewers.update(("Privacy", "Responsible AI"))
        controls.append("Define training-data use, retention, and deletion controls")
    if request.external_data == "yes":
        exposure += 45
        reviewers.add("Information Security")
        controls.append("Document data residency and transfer safeguards")
    if request.cross_border == "yes":
        exposure += 25
        reviewers.add("Privacy")
        controls.append("Complete cross-border data transfer assessment")
    if request.public_facing == "yes":
        exposure += 45
        reviewers.add("Responsible AI")
        reasons.append("The experience will be externally accessible")
    if request.safety == "yes":
        impact += 75
        regulatory += 50
        reviewers.add("MedTech Quality")
        reasons.append("Incorrect output could affect patient safety")
    if request.quality == "yes":
        impact += 50
        regulatory += 40
        reviewers.add("MedTech Quality")
        reasons.append("Output may influence product quality")
    if request.decisions == "yes":
        impact += 40
        reviewers.add("Responsible AI")
        reasons.append("AI may influence a consequential decision")
    if request.autonomy >= 4:
        reviewers.update(("Enterprise Architecture", "Responsible AI"))
        reasons.append("The application can act in connected systems")
    if "Execute actions" in request.capabilities:
        reviewers.add("Information Security")
    if request.human_review == "yes":
        impact = max(0, impact - 15)
    if request.human_review == "no" and request.autonomy >= 3:
        controls.append("Add human review before consequential actions")
    if request.audit == "no":
        controls.append("Enable prompt, output, and action audit logging")

    dimensions = [
        {"name": "Data sensitivity", "value": min(100, data)},
        {"name": "AI autonomy", "value": request.autonomy * 18},
        {"name": "Business impact", "value": min(100, impact)},
        {"name": "External exposure", "value": min(100, exposure)},
        {"name": "Regulatory relevance", "value": min(100, regulatory)},
    ]
    maximum = max(dimension["value"] for dimension in dimensions)
    average = sum(dimension["value"] for dimension in dimensions) / len(dimensions)
    score = round(maximum * 0.65 + average * 0.35)
    level = "Restricted" if score >= 75 else "High" if score >= 50 else "Moderate" if score >= 22 else "Low"

    return {
        "level": level,
        "score": score,
        "dimensions": dimensions,
        "reasons": reasons or ["No elevated risk indicators selected yet"],
        "reviewers": sorted(reviewers),
        "controls": controls,
    }
