CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    duns_number VARCHAR(20) UNIQUE,
    tax_id VARCHAR(50),
    category VARCHAR(100),
    tier VARCHAR(20) DEFAULT 'Tier 2',
    status VARCHAR(50) DEFAULT 'Active',
    spend_annual NUMERIC(15, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'USD',
    risk_score NUMERIC(5, 2) DEFAULT 0.00,
    overall_health VARCHAR(50) DEFAULT 'Moderate',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    title VARCHAR(100),
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    assessment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    financial_risk NUMERIC(5, 2) DEFAULT 0.00,
    operational_risk NUMERIC(5, 2) DEFAULT 0.00,
    geopolitical_risk NUMERIC(5, 2) DEFAULT 0.00,
    esg_risk NUMERIC(5, 2) DEFAULT 0.00,
    cyber_risk NUMERIC(5, 2) DEFAULT 0.00,
    composite_score NUMERIC(5, 2) DEFAULT 0.00,
    assessment_summary TEXT,
    evaluated_by VARCHAR(100) DEFAULT 'SAINT_AI_AGENT',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    audit_title VARCHAR(255) NOT NULL,
    audit_type VARCHAR(100) DEFAULT 'Compliance & Operational',
    scheduled_date DATE,
    completed_date DATE,
    status VARCHAR(50) DEFAULT 'Pending',
    score NUMERIC(5, 2),
    findings_count INT DEFAULT 0,
    critical_findings_count INT DEFAULT 0,
    auditor_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES supplier_audits(id) ON DELETE CASCADE,
    severity VARCHAR(50) DEFAULT 'Medium',
    category VARCHAR(100),
    description TEXT NOT NULL,
    recommendation TEXT,
    status VARCHAR(50) DEFAULT 'Open',
    target_resolution_date DATE,
    resolved_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    document_type VARCHAR(100) DEFAULT 'Contract',
    file_path TEXT,
    parsed_content TEXT,
    ingestion_status VARCHAR(50) DEFAULT 'Completed',
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    changed_by VARCHAR(100) DEFAULT 'System',
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);
CREATE INDEX IF NOT EXISTS idx_suppliers_risk_score ON suppliers(risk_score);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_supplier ON risk_assessments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_audits_supplier ON supplier_audits(supplier_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_audit ON audit_findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_documents_supplier ON documents(supplier_id);
