import american10 from "wordlist-english/american-words-10.json";
import american20 from "wordlist-english/american-words-20.json";
import american35 from "wordlist-english/american-words-35.json";
import american40 from "wordlist-english/american-words-40.json";
import american50 from "wordlist-english/american-words-50.json";
import british10 from "wordlist-english/british-words-10.json";
import british20 from "wordlist-english/british-words-20.json";
import british35 from "wordlist-english/british-words-35.json";
import british40 from "wordlist-english/british-words-40.json";
import british50 from "wordlist-english/british-words-50.json";
import english10 from "wordlist-english/english-words-10.json";
import english20 from "wordlist-english/english-words-20.json";
import english35 from "wordlist-english/english-words-35.json";
import english40 from "wordlist-english/english-words-40.json";
import english50 from "wordlist-english/english-words-50.json";

/**
 * Words that are not personal names. A capitalized word outside them is treated as a possible name, which
 * catches names from any culture, not only those in a first-name list. SCOWL (via wordlist-english) supplies
 * common English up to size 50; the lists below add what it lacks.
 */

const INDUSTRY_TERMS = [
  "analytics", "onboarding", "offboarding", "dataset", "datasets", "metadata", "api", "apis", "tokenize", "tokenized",
  "tokenised", "tokenization", "tokenisation", "pseudonymous", "pseudonymize", "pseudonymized", "pseudonymised",
  "pseudonymization", "pseudonymisation", "anonymize", "anonymized", "anonymised", "anonymization", "anonymisation",
  "deidentified", "deidentification", "reidentify", "reidentification", "deduplicate", "deduplicated",
  "deduplication", "geolocation", "geofencing", "clickstream", "chatbot", "chatbots", "backend", "frontend",
  "webhook", "webhooks", "biometric", "biometrics", "genomic", "genomics", "wearables", "fintech", "healthtech",
  "adtech", "martech", "ecommerce", "omnichannel", "cybersecurity", "retargeting", "uploads", "uploaded", "optout",
  "hipaa", "gdpr", "ccpa", "cpra", "pci", "dss", "phi", "pii", "crm", "erp", "saas", "etl", "kyc", "aml", "mfa",
  "sso", "sdk", "sdks", "idfa", "gaid", "ehr", "emr", "covid", "ai", "ml", "llm", "llms", "genai", "q1", "q2", "q3",
  "q4", "esg", "subprocessor", "subprocessors", "cleanroom", "cleanrooms", "interoperability", "programmatic",
  "geotargeting", "microtargeting", "personalization", "personalisation", "monetization", "monetisation", "wellness",
  "telehealth", "chargeback", "chargebacks", "ops", "devops", "secops", "mlops", "revops", "finops", "dataops", "sre",
  "qa", "ux", "ui", "dev", "kpi", "kpis", "okr", "okrs", "nps", "csat", "mcc", "sftp", "s3", "elt", "sql", "nosql",
  "csv", "json", "xml", "pdf", "url", "urls", "ip", "faq", "faqs", "b2b", "b2c", "dtc", "roi", "ltv", "cac", "arr",
  "mrr", "gmv", "aov", "sku", "skus", "upsell", "upsert", "geohash", "datalake", "lakehouse", "dbt", "airflow",
  "signup", "signups",
];

/** Platforms, vendors and public bodies a description may name; none identifies a person. */
const ORGANIZATIONS_AND_PRODUCTS = [
  "google", "microsoft", "amazon", "aws", "azure", "apple", "meta", "facebook", "instagram", "whatsapp", "tiktok",
  "snapchat", "linkedin", "twitter", "youtube", "pinterest", "reddit", "netflix", "spotify", "uber", "lyft", "airbnb",
  "salesforce", "snowflake", "databricks", "bigquery", "redshift", "tableau", "looker", "powerbi", "qlik", "segment",
  "mparticle", "amplitude", "mixpanel", "heap", "hubspot", "marketo", "mailchimp", "klaviyo", "braze", "iterable",
  "twilio", "sendgrid", "zendesk", "intercom", "okta", "auth0", "workday", "oracle", "sap", "servicenow", "atlassian",
  "jira", "confluence", "slack", "zoom", "teams", "dropbox", "box", "shopify", "stripe", "plaid", "paypal", "square",
  "adyen", "visa", "mastercard", "amex", "experian", "equifax", "transunion", "acxiom", "liveramp", "epsilon",
  "nielsen", "comscore", "kantar", "habu", "infosum", "decentriq", "optable", "fitbit", "garmin", "epic", "cerner",
  "athenahealth", "allscripts", "meditech", "veeva", "iqvia", "medicaid", "medicare", "cms", "hhs", "ftc", "ico",
  "fda", "nih", "cdc", "nhs", "hmrc", "irs", "sec", "finra", "ofac", "fincen", "openai", "anthropic", "claude",
  "chatgpt", "gemini", "copilot", "supabase", "vercel", "render", "heroku", "postgres", "postgresql", "mysql",
  "mongodb", "kafka", "spark", "hadoop", "excel", "sharepoint", "onedrive", "gmail", "outlook", "android", "ios",
  "chase", "citi", "citibank", "barclays", "hsbc", "santander", "capital", "lloyds", "natwest", "monzo", "revolut",
  "kaiser", "permanente", "optum", "unitedhealth", "anthem", "aetna", "cigna", "humana", "walgreens", "cvs",
  "walmart", "target", "costco", "kroger", "tesco", "sainsbury", "carrefour", "ikea", "nike", "adidas", "starbucks",
  "mcdonalds", "deloitte", "pwc", "kpmg", "accenture", "mckinsey", "gartner", "forrester", "boise",
  "quickbooks", "intuit", "xero", "netsuite", "sage", "gusto", "rippling", "bamboohr", "adp", "paychex", "docusign",
  "adobe", "canva", "figma", "notion", "asana", "trello", "github", "gitlab", "bitbucket", "cloudflare", "datadog",
  "splunk", "pagerduty", "elastic", "elasticsearch", "algolia", "firebase", "sentry", "wordpress", "wix", "squarespace",
  "magento", "bigcommerce", "woocommerce", "venmo", "zelle", "payoneer", "flutterwave", "paystack", "interswitch",
  "mpesa", "safaricom", "mtn", "airtel", "jumia", "opay", "palmpay", "moniepoint", "kuda", "fedex", "ups", "dhl", "usps",
  "delta", "united", "emirates", "verizon", "comcast", "vodafone", "orange", "samsung", "huawei", "xiaomi", "alibaba",
  "tencent", "baidu", "wechat", "alipay", "telegram", "signal", "discord", "roblox", "medallia", "qualtrics",
  "surveymonkey", "typeform", "calendly", "gong", "outreach", "zoominfo", "clearbit", "apollo", "dun", "bradstreet",
];

/** US states and territories; compromise tags a few, such as Virginia, as people. */
const PLACES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "hampshire",
  "mexico", "york", "carolina", "dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "wisconsin", "wyoming", "puerto", "rico", "guam", "columbia",
];

const WORD_LISTS = [
  english10, english20, english35, english40, english50,
  american10, american20, american35, american40, american50,
  british10, british20, british35, british40, british50,
  INDUSTRY_TERMS, ORGANIZATIONS_AND_PRODUCTS, PLACES,
];

let vocabulary: Set<string> | undefined;

function knownWords(): Set<string> {
  if (!vocabulary) {
    vocabulary = new Set();
    for (const list of WORD_LISTS) for (const word of list) vocabulary.add(word.toLowerCase());
  }
  return vocabulary;
}

const PRODUCTS = new Set(ORGANIZATIONS_AND_PRODUCTS);

/** Lower-cased, without a trailing possessive or comma/full stop: "Garcia's," becomes "garcia". */
export function bareWord(word: string): string {
  return word.toLowerCase().replace(/[.,]$/, "").replace(/['’]s$/, "");
}

/** Vendors and platforms that share a spelling with a surname, such as Nielsen or Gartner. */
export function isKnownOrganization(word: string): boolean {
  return PRODUCTS.has(bareWord(word));
}

/** True for ordinary English words, industry terms and well-known organizations; false for most personal names. */
export function isKnownWord(word: string): boolean {
  const bare = bareWord(word);
  const words = knownWords();
  return words.has(bare) || bare.split(/['’-]/).filter(Boolean).every((part) => words.has(part));
}
