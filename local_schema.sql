CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS audit_findings CASCADE;
DROP TABLE IF EXISTS supplier_audits CASCADE;
DROP TABLE IF EXISTS risk_assessments CASCADE;
DROP TABLE IF EXISTS supplier_contacts CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS system_audit_logs CASCADE;
DROP TABLE IF EXISTS risk_alerts CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_code VARCHAR(50),
    legal_name VARCHAR(255) NOT NULL,
    dba_name VARCHAR(255),
    company_type VARCHAR(100),
    ticker_symbol VARCHAR(20),
    tax_classification VARCHAR(100),
    tax_id_type VARCHAR(50),
    tax_id VARCHAR(50),
    contact_name VARCHAR(100),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    website VARCHAR(255),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(50),
    country VARCHAR(100) DEFAULT 'USA',
    category VARCHAR(100),
    payment_terms VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'Active',
    diverse_supplier BOOLEAN DEFAULT FALSE,
    news_cadence VARCHAR(50) DEFAULT 'Weekly',
    market_news TEXT,
    market_news_updated TIMESTAMP WITH TIME ZONE,
    news_keywords TEXT,
    alerts_enabled BOOLEAN DEFAULT TRUE,
    procurement_manager_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'System'
);

CREATE TABLE risk_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) DEFAULT 'Medium',
    title VARCHAR(255) NOT NULL,
    detail TEXT,
    source_url TEXT,
    status VARCHAR(50) DEFAULT 'NEW',
    notified_to VARCHAR(255),
    notified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO suppliers (
    supplier_code, legal_name, dba_name, category, status, city, state, country, 
    contact_name, contact_email, payment_terms, currency, alerts_enabled
) VALUES 
('SUP-1001', 'Global Chip Dynamics Inc.', 'Global Chip Dynamics', 'Semiconductors', 'Active', 'San Jose', 'CA', 'USA', 'Alice Chen', 'alice@globalchip.com', 'Net 30', 'USD', true),
('SUP-1002', 'Nexus Logistics Group LLC', 'Nexus Logistics', 'Logistics & Freight', 'Active', 'Dallas', 'TX', 'USA', 'Marcus Vance', 'marcus@nexuslogistics.com', 'Net 60', 'USD', true),
('SUP-1003', 'Apex Precision Sensors Ltd.', 'Apex Sensors', 'Electronics', 'Active', 'Austin', 'TX', 'USA', 'Elena Rostova', 'elena@apexsensors.com', 'Net 45', 'USD', true);

INSERT INTO risk_alerts (supplier_id, event_type, severity, title, detail, status)
SELECT id, 'Supply Disruption', 'High', 'Port Congestion Delay', 'Shipments delayed by 14 days due to West Coast labor bottleneck.', 'NEW'
FROM suppliers WHERE supplier_code = 'SUP-1002';
