export type OfficeLevel = "municipal" | "provincial" | "federal";

export type Representative = {
  name: string;
  elected_office: string;
  district_name?: string;
  party_name?: string;
  email?: string;
  url?: string;
  photo_url?: string;
  offices?: Array<{ type?: string; tel?: string; fax?: string; postal?: string }>;
  source_url?: string;
};

export type LookupResponse = {
  postal: string;
  city?: string;
  province?: string;
  reps: {
    municipal: Representative[];
    provincial: Representative[];
    federal: Representative[];
  };
  note?: string;
};

export type IssueItem = {
  title: string;
  summary?: string;
  link: string;
  publishedAt?: string;
  source: "city" | "provincial" | "federal";
};

export type IssuesResponse = {
  source: "city" | "provincial" | "federal";
  items: IssueItem[];
};
