# Security Documentation Index

Master navigation guide for the complete Claros DPP security documentation system.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Security Documentation Overview](#security-documentation-overview)
3. [Document Descriptions](#document-descriptions)
4. [Getting Started Scenarios](#getting-started-scenarios)
5. [Task-Based Usage Guide](#task-based-usage-guide)
6. [Security Statistics](#security-statistics)
7. [Related Documentation](#related-documentation)

---

## Quick Navigation

### By Security Topic

| Topic | Primary Document | Secondary Resources |
|-------|-----------------|----------------------|
| **User Access** | [AUTHENTICATION.md](AUTHENTICATION.md) | [access-revocation-process.md](access-revocation-process.md), [identifier-persistence-policy.md](identifier-persistence-policy.md) |
| **Data Encryption** | [DATA_PROTECTION.md](DATA_PROTECTION.md) | [signing-and-verification.md](signing-and-verification.md), [eidas-qsealc-integration.md](eidas-qsealc-integration.md) |
| **Audit & Compliance** | [AUDIT_LOGGING.md](AUDIT_LOGGING.md) | [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [AUTHENTICATION.md](AUTHENTICATION.md) |
| **Digital Signatures** | [signing-and-verification.md](signing-and-verification.md) | [eidas-qsealc-integration.md](eidas-qsealc-integration.md), [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md) |
| **Non-Repudiation** | [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) | [signing-and-verification.md](signing-and-verification.md), [eidas-qsealc-integration.md](eidas-qsealc-integration.md) |
| **Backup & Recovery** | [document-persistence-and-backup.md](document-persistence-and-backup.md) | [backup-continuity-policy.md](backup-continuity-policy.md), [backup-public-handover.md](backup-public-handover.md) |
| **Access Continuity** | [backup-continuity-policy.md](backup-continuity-policy.md) | [document-persistence-and-backup.md](document-persistence-and-backup.md), [access-revocation-process.md](access-revocation-process.md) |
| **Public Backup** | [backup-public-handover.md](backup-public-handover.md) | [document-persistence-and-backup.md](document-persistence-and-backup.md), [backup-continuity-policy.md](backup-continuity-policy.md) |
| **Counterfeiting Prevention** | [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md) | [signing-and-verification.md](signing-and-verification.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) |
| **EU Compliance** | [eidas-qsealc-integration.md](eidas-qsealc-integration.md) | [signing-and-verification.md](signing-and-verification.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) |
| **DID Persistence** | [identifier-persistence-policy.md](identifier-persistence-policy.md) | [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [document-persistence-and-backup.md](document-persistence-and-backup.md) |

---

## Security Documentation Overview

The Claros DPP security documentation system comprises **12 comprehensive documents** covering all aspects of system security, compliance, and data protection. These documents are organized into three layers:

### Layer 1: Foundation (Authentication & Data Protection)
- **[AUTHENTICATION.md](AUTHENTICATION.md)** - User authentication mechanisms and session management
- **[DATA_PROTECTION.md](DATA_PROTECTION.md)** - Encryption strategies and secure storage
- **[AUDIT_LOGGING.md](AUDIT_LOGGING.md)** - Change tracking and audit trail implementation

### Layer 2: Advanced Security (Signing, Backup, Compliance)
- **[signing-and-verification.md](signing-and-verification.md)** - Digital signature implementation and verification
- **[eidas-qsealc-integration.md](eidas-qsealc-integration.md)** - EU qualified electronic signature compliance
- **[document-persistence-and-backup.md](document-persistence-and-backup.md)** - Backup creation, storage, and recovery
- **[backup-continuity-policy.md](backup-continuity-policy.md)** - Access continuity during backup/restore
- **[backup-public-handover.md](backup-public-handover.md)** - Public backup availability and fallback

### Layer 3: Operations & Assurance (Audit, Non-Repudiation, Recovery)
- **[audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)** - Audit evidence protection and anchoring
- **[anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md)** - Fraud prevention and verification
- **[access-revocation-process.md](access-revocation-process.md)** - Permission revocation and emergency procedures
- **[identifier-persistence-policy.md](identifier-persistence-policy.md)** - DID and user/company identifier recovery

---

## Document Descriptions

### [AUTHENTICATION.md](AUTHENTICATION.md)

**Purpose**: Complete guide to user authentication, session management, and authorization mechanisms.

**Key Topics**:
- JWT Bearer token authentication
- Role-based access control (super_admin, company_admin, editor, viewer)
- Session management and token expiration
- Password security and reset procedures
- Multi-factor authentication concepts
- API key management
- Third-party OAuth integration

**Typical Usage**:
- Setting up authentication in new applications
- Understanding user roles and permissions
- Implementing session management
- Configuring token expiration policies

**Related Docs**: [DATA_PROTECTION.md](DATA_PROTECTION.md), [access-revocation-process.md](access-revocation-process.md), [AUDIT_LOGGING.md](AUDIT_LOGGING.md)

---

### [DATA_PROTECTION.md](DATA_PROTECTION.md)

**Purpose**: Comprehensive guide to data encryption, secure storage, and compliance with data protection standards.

**Key Topics**:
- Data classification levels (public, internal, confidential, critical)
- Encryption at rest (database, backup, storage)
- Encryption in transit (TLS, HTTPS)
- Password hashing and salting
- Sensitive data handling (API keys, credentials)
- Key management and rotation
- GDPR, SOC 2, ISO 27001 compliance
- Secure disposal and deletion procedures

**Typical Usage**:
- Implementing encryption for new data types
- Understanding compliance requirements
- Setting up secure key management
- Protecting sensitive configuration data

**Related Docs**: [AUTHENTICATION.md](AUTHENTICATION.md), [signing-and-verification.md](signing-and-verification.md), [AUDIT_LOGGING.md](AUDIT_LOGGING.md)

---

### [AUDIT_LOGGING.md](AUDIT_LOGGING.md)

**Purpose**: Complete implementation guide for audit logging, forensic analysis, and compliance reporting.

**Key Topics**:
- Audit log schema and database structure
- What to log (authentication, data changes, access)
- What NOT to log (passwords, secrets, excessive debug info)
- Query and analysis capabilities
- Activity dashboards and forensic reconstruction
- Anomaly detection and suspicious activity alerts
- Data retention policies (2-year active, 5-year archived)
- Compliance reporting (GDPR, SOC 2, ISO 27001)
- Troubleshooting and performance optimization

**Typical Usage**:
- Understanding audit log structure and queries
- Running forensic analysis on past events
- Generating compliance reports
- Troubleshooting audit performance issues

**Related Docs**: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [access-revocation-process.md](access-revocation-process.md), [AUTHENTICATION.md](AUTHENTICATION.md)

---

### [signing-and-verification.md](signing-and-verification.md)

**Purpose**: Guide to implementing digital signatures, verification mechanisms, and cryptographic signing standards.

**Key Topics**:
- JWS (JSON Web Signature) implementation
- RS256 and ES256 signature algorithms
- Certificate and key pair management
- Signature verification procedures
- Verifiable Credentials (VC) standards
- JWT claims and validation
- Revocation certificate handling
- Signing workflow implementation
- Configuration options and policy control

**Typical Usage**:
- Implementing signature creation in applications
- Verifying incoming signatures
- Configuring signature algorithms
- Understanding VC issuance and validation

**Related Docs**: [eidas-qsealc-integration.md](eidas-qsealc-integration.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md)

---

### [eidas-qsealc-integration.md](eidas-qsealc-integration.md)

**Purpose**: EU regulatory compliance guide for qualified electronic signatures and seals (eIDAS regulation).

**Key Topics**:
- eIDAS (Electronic Identification and Trust Services) regulation overview
- QSealC (Qualified Seal Certificates) compliance requirements
- EU Trusted List (EUTL) integration
- Qualified timestamp services
- Legal validity of qualified seals
- TSA (Time Stamp Authority) integration
- Certificate management and lifecycle
- Compliance verification procedures
- Production deployment considerations

**Typical Usage**:
- Implementing EU-compliant signatures for legal documents
- Setting up qualified timestamp services
- Verifying EU trust status
- Ensuring regulatory compliance for international deployments

**Related Docs**: [signing-and-verification.md](signing-and-verification.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [DATA_PROTECTION.md](DATA_PROTECTION.md)

---

### [document-persistence-and-backup.md](document-persistence-and-backup.md)

**Purpose**: Comprehensive guide to backup creation, storage strategies, and disaster recovery procedures.

**Key Topics**:
- Backup types (full, incremental, differential)
- PostgreSQL backup mechanisms
- Docker volume backup procedures
- Backup storage locations and retention
- Recovery procedures and testing
- Backup compression and deduplication
- Versioning and change tracking
- S3-compatible backup storage (OCI Object Storage)
- Backup validation and integrity checking
- Disaster recovery planning

**Typical Usage**:
- Setting up automated backup procedures
- Recovering data from backups
- Testing backup integrity
- Planning disaster recovery scenarios
- Configuring backup retention policies

**Related Docs**: [backup-continuity-policy.md](backup-continuity-policy.md), [backup-public-handover.md](backup-public-handover.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)

---

### [backup-continuity-policy.md](backup-continuity-policy.md)

**Purpose**: Guide to maintaining access and user continuity during backup and restore operations.

**Key Topics**:
- Access right continuity principles
- Session invalidation during restore
- Database state consistency
- User communication during backup
- Permission re-establishment after restore
- Audit trail continuity
- Configuration options and defaults
- Emergency restore procedures
- Public backup fallback scenarios

**Typical Usage**:
- Planning backup windows with minimal impact
- Understanding access behavior during restore
- Configuring backup policies for your deployment
- Handling emergency restore situations

**Related Docs**: [document-persistence-and-backup.md](document-persistence-and-backup.md), [backup-public-handover.md](backup-public-handover.md), [access-revocation-process.md](access-revocation-process.md)

---

### [backup-public-handover.md](backup-public-handover.md)

**Purpose**: Guide to maintaining public backup availability as a fallback source for digital product passports.

**Key Topics**:
- Public backup concept and purpose
- Backup consistency and verification
- Public URL provisioning
- Fallback activation procedures
- Backup integrity checks
- Storage backend configuration
- Monitoring and alerting
- Recovery scenarios
- Data synchronization between primary and backup

**Typical Usage**:
- Setting up redundant public backup service
- Configuring fallback DNS and URL routing
- Monitoring backup health and synchronization
- Testing fallback activation procedures

**Related Docs**: [document-persistence-and-backup.md](document-persistence-and-backup.md), [backup-continuity-policy.md](backup-continuity-policy.md), [AUDIT_LOGGING.md](AUDIT_LOGGING.md)

---

### [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)

**Purpose**: Guide to audit evidence protection, cryptographic anchoring, and non-repudiation assurance.

**Key Topics**:
- Non-repudiation concepts and implementation
- Audit evidence anchoring (blockchain, timestamping)
- Merkle tree hashing for batch anchoring
- External evidence systems (immutable storage, compliance archives)
- Timestamp authority integration
- Anchor response verification
- Evidence preservation and archival
- Audit trail immutability assurance
- Regulatory compliance for evidence (eIDAS, GDPR)

**Typical Usage**:
- Implementing non-repudiation for critical operations
- Setting up external evidence anchoring
- Preserving audit evidence for compliance audits
- Verifying integrity of historical audit records

**Related Docs**: [AUDIT_LOGGING.md](AUDIT_LOGGING.md), [signing-and-verification.md](signing-and-verification.md), [eidas-qsealc-integration.md](eidas-qsealc-integration.md)

---

### [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md)

**Purpose**: Guide to preventing counterfeiting and "phishing via QR code" (quishing) attacks on digital product passports.

**Key Topics**:
- Counterfeiting threats and attack vectors
- Quishing (QR code phishing) prevention
- Signature-based verification mechanisms
- Metadata authenticity checks
- QR code security and encoding
- Carrier/substrate authentication
- Verification workflow implementation
- User verification guidance
- Attack surface analysis
- Detection and reporting procedures

**Typical Usage**:
- Implementing verification workflows in applications
- Educating users on verification procedures
- Setting up metadata authenticity checks
- Analyzing and responding to counterfeiting incidents

**Related Docs**: [signing-and-verification.md](signing-and-verification.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [eidas-qsealc-integration.md](eidas-qsealc-integration.md)

---

### [access-revocation-process.md](access-revocation-process.md)

**Purpose**: Guide to access revocation procedures and emergency access termination.

**Key Topics**:
- Who can revoke (super_admin, company_admin)
- What can be revoked (user audiences, access grants, API keys, sessions)
- Standard revocation workflow
- Emergency revocation procedures
- Session invalidation mechanisms
- Database state management during revocation
- Audit logging of revocation events
- Recovery procedures
- Emergency contact procedures

**Typical Usage**:
- Revoking user access (offboarding, security incidents)
- Implementing emergency access termination
- Understanding revocation audit trails
- Recovering from incorrect revocations

**Related Docs**: [AUTHENTICATION.md](AUTHENTICATION.md), [AUDIT_LOGGING.md](AUDIT_LOGGING.md), [backup-continuity-policy.md](backup-continuity-policy.md)

---

### [identifier-persistence-policy.md](identifier-persistence-policy.md)

**Purpose**: Guide to DID (Decentralized Identifier) and entity identifier persistence, recovery, and uniqueness guarantees.

**Key Topics**:
- DID structure and components
- Company identifier persistence
- User identifier uniqueness
- Passport identifier versioning
- Database uniqueness constraints
- DID recovery after backup restore
- Collision prevention mechanisms
- Identifier resolution
- Audit trail for identifier changes
- Migration procedures for identifier reassignment

**Typical Usage**:
- Understanding DID structure and resolution
- Implementing identifier recovery after restore
- Verifying identifier uniqueness
- Planning identifier migration strategies

**Related Docs**: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md), [document-persistence-and-backup.md](document-persistence-and-backup.md), [access-revocation-process.md](access-revocation-process.md)

---

## Getting Started Scenarios

### Scenario 1: Implementing Authentication for New Application

**Goal**: Add user authentication to a new application component.

**Recommended Reading Order**:
1. Start: [AUTHENTICATION.md](AUTHENTICATION.md) - Understand JWT and role-based access control
2. Reference: [DATA_PROTECTION.md](DATA_PROTECTION.md) - How to securely store credentials
3. Then: [AUDIT_LOGGING.md](AUDIT_LOGGING.md) - Log authentication events
4. Final: [access-revocation-process.md](access-revocation-process.md) - Handle user access revocation

**Key Sections**: AUTHENTICATION → OAuth flow, JWT claims, RBAC setup

---

### Scenario 2: Setting Up Digital Signatures

**Goal**: Add signature creation and verification to DPP issuance.

**Recommended Reading Order**:
1. Start: [signing-and-verification.md](signing-and-verification.md) - Understand signature mechanisms
2. Reference: [eidas-qsealc-integration.md](eidas-qsealc-integration.md) - EU compliance requirements
3. Then: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) - Non-repudiation assurance
4. Final: [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md) - Verification procedures

**Key Sections**: signing-and-verification → JWS, algorithms, verification flow

---

### Scenario 3: Implementing Backup & Disaster Recovery

**Goal**: Set up automated backup and restore procedures.

**Recommended Reading Order**:
1. Start: [document-persistence-and-backup.md](document-persistence-and-backup.md) - Backup procedures
2. Reference: [backup-continuity-policy.md](backup-continuity-policy.md) - User continuity during restore
3. Then: [backup-public-handover.md](backup-public-handover.md) - Public backup availability
4. Final: [DATA_PROTECTION.md](DATA_PROTECTION.md) - Encryption and secure backup storage

**Key Sections**: document-persistence-and-backup → PostgreSQL procedures, retention policies

---

### Scenario 4: Compliance Audit & Reporting

**Goal**: Generate compliance reports and verify audit trails.

**Recommended Reading Order**:
1. Start: [AUDIT_LOGGING.md](AUDIT_LOGGING.md) - Audit log structure and queries
2. Reference: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) - Evidence preservation
3. Then: [eidas-qsealc-integration.md](eidas-qsealc-integration.md) - EU compliance requirements
4. Final: [DATA_PROTECTION.md](DATA_PROTECTION.md) - GDPR, SOC 2, ISO 27001 requirements

**Key Sections**: AUDIT_LOGGING → Compliance reporting, anomaly detection

---

### Scenario 5: Security Incident Response

**Goal**: Respond to unauthorized access or security breach.

**Recommended Reading Order**:
1. Start: [access-revocation-process.md](access-revocation-process.md) - Emergency revocation procedures
2. Reference: [AUDIT_LOGGING.md](AUDIT_LOGGING.md) - Forensic analysis of breach
3. Then: [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md) - Verify system integrity
4. Final: [document-persistence-and-backup.md](document-persistence-and-backup.md) - Restore from backup if needed

**Key Sections**: access-revocation-process → Emergency revocation, investigation procedures

---

### Scenario 6: Offboarding User Access

**Goal**: Safely revoke all access for departing employee.

**Recommended Reading Order**:
1. Start: [access-revocation-process.md](access-revocation-process.md) - Revocation procedures
2. Reference: [AUTHENTICATION.md](AUTHENTICATION.md) - Session invalidation
3. Then: [AUDIT_LOGGING.md](AUDIT_LOGGING.md) - Verify all access revoked
4. Final: [backup-continuity-policy.md](backup-continuity-policy.md) - Data continuity concerns

**Key Sections**: access-revocation-process → Standard revocation, session invalidation

---

## Task-Based Usage Guide

### Task: Configure JWT Authentication

**Primary Document**: [AUTHENTICATION.md](AUTHENTICATION.md) - JWT Bearer token section
**Secondary References**: [DATA_PROTECTION.md](DATA_PROTECTION.md) - Secret key storage
**Output**: JWT configuration, token expiration policy

---

### Task: Set Up Role-Based Access Control (RBAC)

**Primary Document**: [AUTHENTICATION.md](AUTHENTICATION.md) - RBAC section
**Secondary References**: [access-revocation-process.md](access-revocation-process.md) - Role revocation
**Output**: Role hierarchy, permission matrix, API authorization rules

---

### Task: Encrypt Sensitive Data

**Primary Document**: [DATA_PROTECTION.md](DATA_PROTECTION.md) - Encryption strategies
**Secondary References**: [signing-and-verification.md](signing-and-verification.md) - Key management
**Output**: Encryption configuration, key rotation schedule

---

### Task: Create Digital Signatures

**Primary Document**: [signing-and-verification.md](signing-and-verification.md)
**Secondary References**: [eidas-qsealc-integration.md](eidas-qsealc-integration.md)
**Output**: Signature implementation, verification workflow

---

### Task: Implement Audit Logging

**Primary Document**: [AUDIT_LOGGING.md](AUDIT_LOGGING.md)
**Secondary References**: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)
**Output**: Audit middleware, logging configuration, query examples

---

### Task: Anchor Audit Evidence

**Primary Document**: [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)
**Secondary References**: [eidas-qsealc-integration.md](eidas-qsealc-integration.md)
**Output**: Anchoring procedure, external evidence integration

---

### Task: Set Up Automated Backups

**Primary Document**: [document-persistence-and-backup.md](document-persistence-and-backup.md)
**Secondary References**: [backup-continuity-policy.md](backup-continuity-policy.md)
**Output**: Backup schedule, retention policy, recovery procedures

---

### Task: Configure Backup Fallback

**Primary Document**: [backup-public-handover.md](backup-public-handover.md)
**Secondary References**: [document-persistence-and-backup.md](document-persistence-and-backup.md)
**Output**: Public backup setup, fallback DNS configuration

---

### Task: Verify Passport Authenticity

**Primary Document**: [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md)
**Secondary References**: [signing-and-verification.md](signing-and-verification.md)
**Output**: Verification workflow, user education materials

---

### Task: Ensure EU Compliance

**Primary Document**: [eidas-qsealc-integration.md](eidas-qsealc-integration.md)
**Secondary References**: [signing-and-verification.md](signing-and-verification.md), [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md)
**Output**: Compliance configuration, certificate integration

---

### Task: Revoke User Access

**Primary Document**: [access-revocation-process.md](access-revocation-process.md)
**Secondary References**: [AUTHENTICATION.md](AUTHENTICATION.md)
**Output**: Revocation confirmation, audit trail verification

---

### Task: Restore from Backup

**Primary Document**: [document-persistence-and-backup.md](document-persistence-and-backup.md)
**Secondary References**: [backup-continuity-policy.md](backup-continuity-policy.md), [identifier-persistence-policy.md](identifier-persistence-policy.md)
**Output**: Restored system, access continuity verification

---

## Security Statistics

### Documentation Coverage

| Metric | Value |
|--------|-------|
| **Total Documents** | 12 |
| **Total Lines** | ~1,000+ |
| **Files with Table of Contents** | 12/12 (100%) ✅ |
| **Files with Related Documentation** | 12/12 (100%) ✅ |
| **Security Topics Covered** | 11 major topics |
| **Getting Started Scenarios** | 6 scenarios |
| **Task-Based Guides** | 12 tasks |

### Layer Distribution

| Layer | Documents | Focus |
|-------|-----------|-------|
| **Layer 1: Foundation** | 3 | Authentication, data protection, basic audit logging |
| **Layer 2: Advanced Security** | 5 | Signatures, EU compliance, backups, access continuity |
| **Layer 3: Operations & Assurance** | 4 | Audit anchoring, anti-counterfeiting, revocation, identifier persistence |

### Topic Interconnectivity

| Document | Cross-References | Interconnection Score |
|----------|-----------------|----------------------|
| AUTHENTICATION.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| DATA_PROTECTION.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| AUDIT_LOGGING.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| signing-and-verification.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| audit-logging-and-anchoring.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| document-persistence-and-backup.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| backup-continuity-policy.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| eidas-qsealc-integration.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| access-revocation-process.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| identifier-persistence-policy.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| anti-counterfeiting-and-quishing.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |
| backup-public-handover.md | 6 | ⭐⭐⭐⭐⭐⭐ (hub document) |

---

## Related Documentation

### Architecture Documentation
- [DID and Passport Model](../architecture/did-and-passport-model.md) - Digital passport structure
- [Services](../architecture/SERVICES.md) - Backend service dependencies
- [Current State Audit](../architecture/current-state-audit.md) - System configuration status
- [OAIS Archive Mapping](../architecture/oais-archive-mapping.md) - Long-term preservation

### API Documentation
- [ENDPOINTS.md](../api/ENDPOINTS.md) - Complete API reference
- [data-carrier-authenticity](../api/data-carrier-authenticity.md) - Metadata authenticity endpoints
- [did-resolution](../api/did-resolution.md) - DID resolution endpoints

### Deployment Documentation
- [OCI Free Tier Deployment](../deployment/oci-free-tier-edge.md) - Production setup and backup

---

**[← Back to Security Docs](../README.md)**
