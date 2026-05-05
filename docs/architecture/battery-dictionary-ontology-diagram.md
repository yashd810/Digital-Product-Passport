# Battery Dictionary Ontology Diagram

Last updated: 2026-05-05

This diagram shows the current semantic model at a compact level. It is not a full expansion of all 100 battery dictionary terms; those live in `apps/backend-api/resources/semantics/battery/v1/terms.json`.

WebVOWL-style source:
- `docs/architecture/battery-dictionary-webvowl.json`

```mermaid
flowchart LR
  Catalog["dcat:Catalog<br/>Claros Battery Dictionary Catalog"]
  Dataset["dcat:Dataset<br/>Claros Battery Dictionary"]
  Distribution["dcat:Distribution<br/>terms/context/category-rules/field-map"]
  Service["dcat:DataService<br/>Dictionary API"]
  DBP["clarosBatteryClass:DigitalBatteryPassport"]
  DPP["dpp:DigitalProductPassport"]
  DPPInfo["DPPInfo"]
  Identifiers["BatteryIdentifiers"]
  OperatorIds["OperatorIdentifiers"]
  ProductData["ProductData / RestrictedProductData"]
  Compliance["BatteryCompliance<br/>Public/Restricted"]
  Carbon["BatteryCarbonFootprint"]
  Materials["BatteryMaterials<br/>Public/Restricted"]
  Circularity["BatteryCircularity / RecycledRenewable / EndUser"]
  Performance["Performance domains<br/>Capacity, Power, Efficiency, Resistance, Lifetime, Temperature, Events"]
  Term["DictionaryTerm<br/>100 generated terms"]
  Range["XSD datatype range<br/>string/dateTime/anyURI/gYearMonth/decimal/integer"]
  Workbook["BatteryPass workbook row<br/>source metadata"]
  Requirement["Battery category requirement<br/>EV/LMT/Industrial/Stationary"]
  Granularity["Component granularity<br/>pack/module/cell"]

  Catalog -->|dcat:dataset| Dataset
  Catalog -->|dcat:service| Service
  Service -->|dcat:servesDataset| Dataset
  Dataset -->|dcat:distribution| Distribution

  DBP -->|rdfs:subClassOf| DPP
  DPPInfo -->|rdfs:subClassOf| DBP
  Identifiers -->|rdfs:subClassOf| DBP
  OperatorIds -->|rdfs:subClassOf| DBP
  ProductData -->|rdfs:subClassOf| DBP
  Compliance -->|rdfs:subClassOf| DBP
  Carbon -->|rdfs:subClassOf| DBP
  Materials -->|rdfs:subClassOf| DBP
  Circularity -->|rdfs:subClassOf| DBP
  Performance -->|rdfs:subClassOf| DBP
  Term -->|rdfs:domain| DPPInfo
  Term -->|rdfs:domain| Identifiers
  Term -->|rdfs:domain| OperatorIds
  Term -->|rdfs:domain| ProductData
  Term -->|rdfs:domain| Compliance
  Term -->|rdfs:domain| Carbon
  Term -->|rdfs:domain| Materials
  Term -->|rdfs:domain| Circularity
  Term -->|rdfs:domain| Performance
  Term -->|rdfs:range| Range
  Term -->|sourceWorkbookRow| Workbook
  Term -->|batteryCategoryRequirements| Requirement
  Term -->|componentGranularity| Granularity
```

## DCAT/DCAT-AP Status

Current status: DCAT/DCAT-AP-aligned, not yet a fully validated DCAT-AP publication.

Implemented:
- `catalog.jsonld` with `dcat:Catalog`, `dcat:Dataset`, `dcat:Distribution`, `dcat:DataService`, and `dcat:CatalogRecord`.
- DCAT 3 and DCAT-AP 3.0.1 conformance links.
- JSON-LD context with protected terms, `id`/`type` aliases, and `DigitalBatteryPassport`.
- Explicit term-level `domain` and `range`.
- Spherity v0.2-style section domains, for example `DPPInfo`, `BatteryIdentifiers`, `BatteryCarbonFootprint`, `CapacityEnergyVoltagePublic`, and `TemperatureConditionsRestricted`, instead of one generic `DictionaryTerm` domain.
- Workbook-derived traceability for all 100 terms.

Still missing for a stronger/full DCAT-AP implementation:
- Run the generated catalog through a DCAT-AP 3.0.1 SHACL validator and check every mandatory/recommended property.
- Add formal license/rights metadata, for example `dcterms:license` and stronger `dcterms:accessRights` at dataset/distribution level.
- Add content negotiation for canonical IRIs so `/dictionary/battery/v1`, `/dataset`, `/catalog`, and term IRIs can serve HTML or RDF/JSON-LD depending on `Accept`.
- Publish a formal ontology file in RDF/Turtle or JSON-LD beyond the compact JSON artifacts.
- Add SHACL shapes for term values, required fields by battery category, and enumerations/code lists.
- Add persistent human-readable pages for every term IRI, not only API JSON responses.
- Add version history/change records using `adms:versionNotes`, `owl:versionInfo`, or catalog records per release.
