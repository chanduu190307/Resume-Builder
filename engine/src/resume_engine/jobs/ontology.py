"""Curated skills ontology: canonical names, aliases and "implies" relations.

Format of each row:   Canonical | category | aliases | implies
* aliases: other ways the same skill is written. Prefix an alias with "=" to
  match it case-sensitively (for words that are also ordinary English, e.g.
  "=Go", "=Swift", "=Excel"), otherwise matching ignores case.
* implies: broader skills this one is evidence of (PostgreSQL implies SQL).
  Used only to mark a job requirement as "potentially supported"; the user
  always confirms before such a skill is added.

Keep entries factual and uncontroversial. Add new skills here; tests check the
table parses and that aliases are not ambiguous across skills.
"""

from __future__ import annotations

from dataclasses import dataclass, field

_DATA = """
Python|language|python3|
JavaScript|language|js,ecmascript,es6|
TypeScript|language|ts|JavaScript
Java|language|java se,java ee,j2ee|
Kotlin|language||
Scala|language||
C++|language|cpp|
C#|language|csharp,c sharp|
=C|language||
=Go|language|golang|
=Rust|language||
=Ruby|language||
PHP|language||
=Swift|language||
Objective-C|language|objective c,objc|
=R|language||
MATLAB|language||
Perl|language||
=Dart|language||
Elixir|language||
Haskell|language||
Bash|language|shell scripting,bash scripting,shell script|
PowerShell|language||
SQL|language|structured query language|
HTML|language|html5|
CSS|language|css3|
Sass|language|scss|CSS
GraphQL|technology||
React|framework|react.js,reactjs,react js|JavaScript
React Native|framework|react-native|React
Next.js|framework|nextjs,next js|React
Vue.js|framework|vue,vuejs,vue js|JavaScript
Nuxt|framework|nuxt.js,nuxtjs|Vue.js
Angular|framework|angularjs,angular.js|TypeScript
Svelte|framework|sveltekit|JavaScript
jQuery|framework|jquery|JavaScript
Redux|framework||React
Tailwind CSS|framework|tailwind,tailwindcss|CSS
Bootstrap|framework||CSS
Node.js|framework|nodejs,node js,=Node|JavaScript
=Express|framework|express.js,expressjs|Node.js
NestJS|framework|nest.js|Node.js
Django|framework||Python
=Flask|framework||Python
FastAPI|framework|fast api|Python
Spring Boot|framework|springboot,=Spring|Java
Hibernate|framework||Java
.NET|framework|dotnet,.net core,asp.net,asp.net core|C#
Ruby on Rails|framework|rails,ror|Ruby
Laravel|framework||PHP
Flutter|framework||Dart
SwiftUI|framework||Swift
Android|platform|android development,android sdk|
iOS|platform|ios development|
Electron|framework||JavaScript
pandas|library||Python
NumPy|library|numpy|Python
SciPy|library|scipy|Python
scikit-learn|library|sklearn,scikit learn|Machine Learning
TensorFlow|library|tensorflow|Deep Learning
PyTorch|library|pytorch,torch|Deep Learning
Keras|library||Deep Learning
=JAX|library||Deep Learning
Hugging Face|library|huggingface,hugging face transformers,transformers library|NLP
Matplotlib|library||Data Visualization
Seaborn|library||Data Visualization
Plotly|library||Data Visualization
D3.js|library|d3,d3js|Data Visualization
OpenCV|library|opencv|Computer Vision
Apache Spark|data|=Spark,pyspark,spark sql|Big Data
Hadoop|data||Big Data
Apache Kafka|data|kafka|Event Streaming
Apache Airflow|data|airflow|Data Pipelines
dbt|data|=dbt,data build tool|SQL
=Snowflake|data||Data Warehousing
BigQuery|data|google bigquery|Data Warehousing
Amazon Redshift|data|redshift|Data Warehousing
Databricks|data||Apache Spark
ETL|data|elt,extract transform load|Data Pipelines
Data Pipelines|data|data pipeline|
Data Warehousing|data|data warehouse,data warehouses|
Big Data|data||
Event Streaming|data|stream processing|
PostgreSQL|database|postgres,psql,postgre sql|SQL
MySQL|database|mysql|SQL
SQL Server|database|ms sql,mssql,microsoft sql server,t-sql,tsql|SQL
Oracle Database|database|oracle db,pl/sql,plsql|SQL
SQLite|database||SQL
MongoDB|database|mongo|NoSQL
Redis|database||NoSQL
Cassandra|database|apache cassandra|NoSQL
DynamoDB|database|dynamo db|NoSQL
Elasticsearch|database|elastic search,opensearch|
Neo4j|database||
NoSQL|database|nosql databases|
AWS|cloud|amazon web services|Cloud Computing
Azure|cloud|microsoft azure|Cloud Computing
Google Cloud|cloud|gcp,google cloud platform|Cloud Computing
Cloud Computing|cloud|cloud|
AWS Lambda|cloud|lambda functions|AWS
Amazon S3|cloud|=S3,aws s3|AWS
Amazon EC2|cloud|=EC2,aws ec2|AWS
Serverless|cloud|serverless architecture|
Docker|devops|docker containers|Containers
Kubernetes|devops|k8s|Containers
Containers|devops|containerization,containerisation|
=Helm|devops||Kubernetes
Terraform|devops||Infrastructure as Code
Ansible|devops||Infrastructure as Code
Infrastructure as Code|devops|iac|
CI/CD|devops|ci cd,continuous integration,continuous delivery,continuous deployment|
Jenkins|devops||CI/CD
GitHub Actions|devops|github actions|CI/CD
GitLab CI|devops|gitlab ci/cd|CI/CD
CircleCI|devops||CI/CD
Linux|devops|unix|
Git|tool|version control|
GitHub|tool||Git
GitLab|tool||Git
Prometheus|devops||Monitoring
Grafana|devops||Monitoring
Datadog|devops||Monitoring
Monitoring|devops|observability|
Nginx|devops|=nginx|
Microservices|architecture|microservice,micro-services,microservice architecture|
REST APIs|architecture|restful,rest api,restful apis,restful services|API Design
API Design|architecture|api development,apis|
gRPC|architecture|grpc|
Distributed Systems|architecture|distributed system|
System Design|architecture|systems design|
Event-Driven Architecture|architecture|event driven,event-driven|
Object-Oriented Programming|practice|oop,object oriented programming,object-oriented design|
Data Structures|practice|data structures and algorithms,dsa|
Algorithms|practice||
Unit Testing|practice|unit tests|Software Testing
Test-Driven Development|practice|tdd|Software Testing
Software Testing|practice|testing,qa testing,quality assurance|
Selenium|tool||Software Testing
=Cypress|tool||Software Testing
=Playwright|tool||Software Testing
=Jest|tool||Software Testing
pytest|tool|=pytest|Software Testing
JUnit|tool||Software Testing
Agile|methodology|agile methodologies,agile development|
Scrum|methodology||Agile
Kanban|methodology||Agile
Jira|tool||
Confluence|tool||
Machine Learning|data|ml,machine-learning|
Deep Learning|data|deep-learning,neural networks|Machine Learning
NLP|data|natural language processing|Machine Learning
Computer Vision|data||Machine Learning
Large Language Models|data|llm,llms,large language model,generative ai,genai|Machine Learning
Speech Recognition|data|asr,automatic speech recognition|Machine Learning
MLOps|data|ml ops|Machine Learning
Statistics|data|statistical analysis|
A/B Testing|data|ab testing,a/b tests,split testing,experimentation|Statistics
Data Analysis|data|data analytics,analyse data,analyze data|
Data Visualization|data|data visualisation,dashboards,dashboarding|
Data Modeling|data|data modelling|
=Excel|tool|microsoft excel,ms excel|
Power BI|tool|powerbi,power-bi|Data Visualization
Tableau|tool||Data Visualization
Looker|tool||Data Visualization
Google Analytics|tool|google analytics 4,ga4|Web Analytics
Web Analytics|marketing||
Figma|design||UI Design
=Sketch|design||UI Design
Adobe XD|design|=XD|UI Design
Adobe Photoshop|design|photoshop|Graphic Design
Adobe Illustrator|design|illustrator|Graphic Design
Adobe InDesign|design|indesign|Graphic Design
UI Design|design|user interface design,interface design|
UX Design|design|user experience design,ux|
User Research|design|usability testing,ux research|
Wireframing|design|wireframes|
Prototyping|design|prototypes|
Graphic Design|design||
Accessibility|design|wcag,a11y|
SEO|marketing|search engine optimization,search engine optimisation|
SEM|marketing|search engine marketing,ppc,pay-per-click|
Paid Social|marketing|paid social media,social media advertising,social ads|
Social Media Marketing|marketing|social media|
Content Marketing|marketing|content strategy|
Email Marketing|marketing|email campaigns,lifecycle marketing,lifecycle email|
Marketing Analytics|marketing||
HubSpot|tool||Marketing Automation
Salesforce|tool|sfdc|CRM
Marketing Automation|marketing||
CRM|marketing|customer relationship management|
Meta Ads Manager|tool|facebook ads,meta ads|Paid Social
Google Ads|tool|adwords,google adwords|SEM
Semrush|tool||SEO
Copywriting|marketing||
Brand Management|marketing|branding|
Project Management|management|project planning|
Product Management|management|product manager|
Stakeholder Management|management|stakeholder engagement|
People Management|management|team management,line management,managing teams,managing people,people manager,manage a team,managed a team|
Leadership|soft|leading teams,team leadership|
Mentoring|soft|mentorship,coaching|
Communication|soft|communication skills,written communication,verbal communication|
Presentation Skills|soft|presenting,public speaking,presentations|
Problem Solving|soft|problem-solving|
Teamwork|soft|collaboration,cross-functional collaboration|
Time Management|soft|prioritization,prioritisation|
Customer Service|soft|customer support,client service|
Negotiation|soft||
Budgeting|finance|budget management|
Financial Analysis|finance|financial modeling,financial modelling|
Accounting|finance|bookkeeping|
Forecasting|finance||
QuickBooks|tool||Accounting
=SAP|tool||
Risk Management|finance|risk assessment|
Compliance|finance|regulatory compliance|
Patient Care|healthcare|patient-centered care,patient centred care|
Ventilator Management|healthcare|mechanical ventilation,ventilated patients|Critical Care
Hemodynamic Monitoring|healthcare|haemodynamic monitoring|Critical Care
Critical Care|healthcare|intensive care,icu|
Sepsis Protocols|healthcare|sepsis management|
Central Line Care|healthcare|central lines|
Patient Education|healthcare|patient and family education,family education|
Epic EHR|tool|=Epic,electronic health records,ehr,emr|
BLS|certification|basic life support|
ACLS|certification|advanced cardiovascular life support|
CCRN|certification|critical care registered nurse|
CKAD|certification|certified kubernetes application developer|Kubernetes
CKA|certification|certified kubernetes administrator|Kubernetes
AWS Certified Solutions Architect|certification|aws solutions architect|AWS
PMP|certification|project management professional|Project Management
Teaching|education|classroom teaching,lesson planning|
Curriculum Development|education|curriculum design|
Tutoring|education||
Research|research|research experience|
Technical Writing|research||
"""


@dataclass(frozen=True)
class Skill:
    name: str
    category: str
    aliases: tuple[str, ...] = ()
    case_sensitive: tuple[str, ...] = ()
    implies: tuple[str, ...] = ()
    terms: tuple[str, ...] = field(default=(), compare=False)
    """Every way of writing it: name + aliases (case-insensitive forms)."""


def _parse() -> dict[str, Skill]:
    skills: dict[str, Skill] = {}
    for raw in _DATA.strip().splitlines():
        if not raw.strip():
            continue
        name, category, aliases, implies = (p.strip() for p in raw.split("|"))
        insensitive, sensitive = [], []
        canonical = name.lstrip("=")
        if name.startswith("="):
            sensitive.append(canonical)
        else:
            insensitive.append(canonical)
        for alias in filter(None, (a.strip() for a in aliases.split(","))):
            (sensitive if alias.startswith("=") else insensitive).append(alias.lstrip("="))
        skills[canonical] = Skill(
            name=canonical,
            category=category,
            aliases=tuple(insensitive),
            case_sensitive=tuple(sensitive),
            implies=tuple(filter(None, (i.strip() for i in implies.split(",")))),
            terms=tuple(dict.fromkeys(insensitive + sensitive)),
        )
    return skills


SKILLS: dict[str, Skill] = _parse()
