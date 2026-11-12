import { describe, expect, it } from "vitest";
import nameDetection from "./fixtures/name-detection.json";
import {
  SensitiveKind,
  describeSensitiveFindings,
  findSensitiveData,
  redactSensitiveData,
} from "../lib/sensitive-data";

const NOW = new Date("2026-11-11T12:00:00Z");
const kinds = (text: string) => findSensitiveData(text, NOW).map((item) => item.kind);

// Descriptions of data, not data: these must never be blocked.
const SAFE = [
  "We want to compare our customer database with a partner’s records to understand which customers we share.",
  "Match hashed email addresses and phone numbers with a retail partner in a clean room.",
  "The dataset includes names, dates of birth, postal addresses and Social Security numbers for 2,000,000 patients.",
  "Share first name, last name and date of birth fields with our fraud vendor for identity checks.",
  "Analyze purchases by customers aged 18-25 and adults 65 and over across 300 stores.",
  "Children under 13 years old are excluded from the advertising audience.",
  "Records are retained for 7 years, then deleted. We expect 1.5 million rows and 100000000 events.",
  "We will use Google Cloud, Microsoft Azure and Snowflake to run the analysis for Boise State.",
  "Our Customer Relationship Management team wants to enrich the Customer Data Platform.",
  "Launch planned for March 1, 2027 with a pilot starting 2026-12-01 for the Q1 2027 campaign.",
  "We partner with Chase Bank, Morgan Stanley and Grant Thornton on anti-money-laundering checks.",
  "We work with Rolls Royce and JP Morgan on supplier payments.",
  "Campaigns in Georgia and Virginia will use mobile advertising IDs and IP addresses.",
  "The member ID is required, and each customer number is tokenized before it leaves our systems.",
  "Use version 2.4.1 of the matching library; the job runs daily at 10:30:00.",
  "Mark the overlapping records so the partner can measure reach in May.",
  "Password and API key management is handled by our security team.",
  "Look at the partner dataset and drop anything older than 30 days.",
  "Patients from Kaiser Permanente and Johns Hopkins will take part in the research study.",
  "Between 300-1000 people per segment, with segments of at least 50 people.",
  "We store a SHA-256 hash of each email address rather than the address itself.",
];

const UNSAFE: [string, SensitiveKind][] = [
  ["Send the file to jane.doe@example.com for review.", "email"],
  ["Contact ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ about the match.", "email"],
  ["Email jane [at] example [dot] com.", "email"],
  ["Email jane at example dot com.", "email"],
  ["Her email is jane.doe @ example . com", "email"],
  ["Call the patient on (208) 555-0147 tomorrow.", "phone"],
  ["Her mobile is +44 7700 900123.", "phone"],
  ["Phone: 555-0147", "phone"],
  ["Customer SSN 123-45-6789 must be matched.", "governmentId"],
  ["Use 123456789 to look them up.", "governmentId"],
  ["Use 123 45 6789 to look them up.", "governmentId"],
  ["NI number AB 12 34 56 C is on file.", "governmentId"],
  ["Charge card 4111 1111 1111 1111 for the subscription.", "card"],
  ["Card 4111-1111-1111-1111", "card"],
  ["Wire it to GB82 WEST 1234 5698 7654 32.", "bankAccount"],
  ["She was born on 03/14/1988 in Boise.", "dateOfBirth"],
  ["DOB: 1990-07-04", "dateOfBirth"],
  ["Date of birth: July 4, 1990.", "dateOfBirth"],
  ["He was born in 1985.", "dateOfBirth"],
  ["Birthday: 4th of July", "dateOfBirth"],
  ["The record from 14/03/1988 shows the visit.", "dateOfBirth"],
  ["The applicant is 34 years old.", "age"],
  ["A 34-year-old customer complained.", "age"],
  ["Age: 34", "age"],
  ["Patient aged 52 was readmitted.", "age"],
  ["We want to share John Smith's records with a partner.", "name"],
  ["Customer Maria Garcia lives in Boise.", "name"],
  ["The patient, jane doe, was admitted.", "name"],
  ["Dr. Patel will review the chart.", "name"],
  ["Mr. Okonkwo approved the release.", "name"],
  ["Her name is Ngozi Adeyemi.", "name"],
  ["Name: Li Wei", "name"],
  ["A client named Chinedu Okafor gave consent.", "name"],
  ["Chinedu Okafor (born 1990) gave consent.", "name"],
  ["Priya Raghunathan's file was sent.", "name"],
  ["Sarah needs the data by Friday.", "name"],
  ["She lives at 123 Main Street, Apt 4B.", "address"],
  ["Ship to 1600 Pennsylvania Avenue NW.", "address"],
  ["Mail to PO Box 1234.", "address"],
  ["Boise, ID 83725-1234", "address"],
  ["London SW1A 1AA", "address"],
  ["Home address: 12 elm st, boise", "address"],
  ["Log in from 192.168.10.24 only.", "ipAddress"],
  ["The device at 2001:db8::8a2e:370:7334 connected.", "ipAddress"],
  ["Advertising ID 38400000-8cf0-11bd-b23e-10b96e40000d", "deviceId"],
  ["Device MAC 00:1A:2B:3C:4D:5E", "deviceId"],
  ["MRN 0045821 belongs to the patient.", "idNumber"],
  ["Member ID: A1234567", "idNumber"],
  ["Account number 000123456789", "idNumber"],
  ["The password is Hunter2!", "secret"],
  ["password: correcthorse", "secret"],
  ["Use key AKIAIOSFODNN7EXAMPLE to read the bucket.", "secret"],
  ["Token sk-proj-abcdefghijklmnopqrstuvwx1234", "secret"],
  ["Auth eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "secret"],
  ["Connect with postgres://admin:s3cret@db.internal/prod", "secret"],
  ["The hash 5f4dcc3b5aa765d61d8327deb882cf99 identifies her.", "secret"],
];

describe("sensitive data detection", () => {
  it.each(SAFE)("allows a description of data: %s", (text) => {
    expect(findSensitiveData(text, NOW)).toEqual([]);
  });

  it.each(UNSAFE)("blocks actual values: %s", (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it.each(nameDetection.names)("redacts every name in: $text", ({ text, names }) => {
    const redacted = redactSensitiveData(text, NOW);
    names.forEach((name) => expect(redacted).not.toContain(name));
  });

  it.each(nameDetection.safe)("allows vendors, places and teams: %s", (text) => {
    expect(findSensitiveData(text, NOW)).toEqual([]);
  });

  it("labels social handles as their own kind", () => {
    expect(kinds("Reach her at @ada_okafor.")).toContain("handle");
  });

  it("cannot be bypassed with invisible characters or look-alike digits", () => {
    expect(kinds("SSN 123​-45-6789")).toContain("governmentId");
    expect(kinds("Card ４１１１ １１１１ １１１１ １１１１")).toContain("card");
    expect(kinds("Call (208) 555–0147")).toContain("phone");
    expect(kinds("jane­.doe@example.com")).toContain("email");
  });

  it("maps findings back to the original text even after normalization", () => {
    const text = "Hi​ ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ ok";
    const [finding] = findSensitiveData(text, NOW);
    expect(text.slice(finding.start, finding.end)).toBe("ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ");
  });

  it("finds several kinds in one description", () => {
    const text = "Customer Maria Garcia (DOB 04/12/1979, SSN 123-45-6789) can be reached at maria@example.com or 208-555-0147.";
    expect(new Set(kinds(text))).toEqual(new Set(["name", "dateOfBirth", "governmentId", "email", "phone"]));
  });

  it("redacts each value with a placeholder naming what was removed", () => {
    const redacted = redactSensitiveData("Send jane.doe@example.com the SSN 123-45-6789 for Dr. Patel.", NOW);
    expect(redacted).toBe("Send [email] the SSN [ID number] for Dr. [name].");
    expect(findSensitiveData(redacted, NOW)).toEqual([]);
    expect(redactSensitiveData(redacted, NOW)).toBe(redacted);
  });

  it("keeps the verb when a sentence starts just before a name", () => {
    expect(redactSensitiveData("Share Ngozi Adeyemi's file with the partner.", NOW)).toBe("Share [name]'s file with the partner.");
  });

  it("describes what was found without repeating the values", () => {
    const findings = findSensitiveData("jane@example.com, john@example.com, 208-555-0147", NOW);
    const summary = describeSensitiveFindings(findings);
    expect(summary).toBe("an email address and a phone number");
    expect(summary).not.toContain("example");
  });

  it("handles long pasted text without slowing down", () => {
    const text = "word ".repeat(4000) + "jane@example.com";
    const started = performance.now();
    findSensitiveData(text, NOW);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(findSensitiveData("a".repeat(50_000), NOW)).toEqual([]);
  });
});
