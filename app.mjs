const WORKPLACE_LABELS = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "Workplace not specified",
};

export function safeApplicationUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, globalThis.location?.href ?? "https://example.invalid/");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function validatePublicData(data) {
  return Boolean(
    data && typeof data === "object" && !Array.isArray(data)
    && data.schemaVersion === 1
    && Array.isArray(data.jobs)
    && Array.isArray(data.companies)
    && Array.isArray(data.sources)
    && data.jobs.every((job) => job && typeof job.id === "string" && typeof job.title === "string")
    && data.companies.every((company) => company && typeof company.id === "string")
  );
}

export function filterAndSortJobs(data, query = "", showClosed = false, sortBy = "rating") {
  if (!validatePublicData(data)) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const companies = new Map(data.companies.map((company) => [company.id, company]));
  const filtered = data.jobs.filter((job) => {
    if (!showClosed && job.status === "closed") return false;
    if (!normalizedQuery) return true;
    const company = companies.get(job.companyId);
    const haystack = [
      job.title, job.descriptionText, job.locationOriginal, job.salaryOriginal,
      job.workplace, job.geographyDecision, company?.name,
    ].filter((part) => typeof part === "string").join(" ").toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
  });
  return filtered.sort((left, right) => {
    if (sortBy === "title") return left.title.localeCompare(right.title);
    const leftRating = companies.get(left.companyId)?.glassdoorRating;
    const rightRating = companies.get(right.companyId)?.glassdoorRating;
    const leftUnknown = typeof leftRating !== "number" || !Number.isFinite(leftRating);
    const rightUnknown = typeof rightRating !== "number" || !Number.isFinite(rightRating);
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    if (!leftUnknown && leftRating !== rightRating) return rightRating - leftRating;
    return left.title.localeCompare(right.title);
  });
}

function appendText(parent, tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function appendSafeLink(parent, value, label, className) {
  const href = safeApplicationUrl(value);
  if (!href) return null;
  const link = document.createElement("a");
  if (className) link.className = className;
  link.href = href;
  link.rel = "noopener noreferrer";
  link.textContent = label;
  parent.append(link);
  return link;
}

function renderJob(job, company, source) {
  const card = document.createElement("article");
  card.className = "job-card";
  card.append(document.createElement("div"));
  const top = card.lastElementChild;
  top.className = "card-top";
  const headingGroup = document.createElement("div");
  appendText(headingGroup, "p", company?.name ?? "Company unavailable", "company");
  appendText(headingGroup, "h2", job.title);
  appendSafeLink(headingGroup, company?.website, "Company website", "rating");
  top.append(headingGroup);

  const badges = document.createElement("div");
  badges.className = "badges";
  appendText(badges, "span", WORKPLACE_LABELS[job.workplace] ?? WORKPLACE_LABELS.unknown, "badge");
  if (job.geographyDecision === "uncertain") appendText(badges, "span", "Location eligibility uncertain", "badge warning");
  if (job.geographyDecision === "excluded") appendText(badges, "span", "Outside target geography", "badge warning");
  if (job.status === "pending_absence") appendText(badges, "span", "Recently missing — status uncertain", "badge warning");
  if (job.status === "closed") appendText(badges, "span", "Closed", "badge warning");
  card.append(badges);

  const meta = document.createElement("div");
  meta.className = "meta";
  if (job.locationOriginal) appendText(meta, "span", job.locationOriginal);
  if (job.salaryOriginal) appendText(meta, "span", job.salaryOriginal);
  card.append(meta);
  if (job.geographyEvidence) appendText(card, "p", `Eligibility evidence: ${job.geographyEvidence}`, "rating");
  if (source?.lastSuccessfulAt) {
    const staleAttempt = source.complete === false ? " · latest attempt incomplete" : "";
    appendText(card, "p", `Source last succeeded: ${new Date(source.lastSuccessfulAt).toLocaleString()}${staleAttempt}`, "rating");
  }
  appendText(card, "p", job.descriptionText, "description");

  const rating = company?.glassdoorRating;
  let ratingText = "Glassdoor rating unavailable";
  if (typeof rating === "number" && Number.isFinite(rating)) {
    const count = Number.isInteger(company.reviewCount) ? ` · ${company.reviewCount.toLocaleString()} reviews` : "";
    const stale = company.ratingFreshness === "stale" ? " · stale" : "";
    const observed = typeof company.ratingObservedAt === "string"
      ? ` · observed ${new Date(company.ratingObservedAt).toLocaleDateString()}` : "";
    const method = company.ratingSource === "manual_override" ? " · manually verified" : " · retrieved source";
    ratingText = `Glassdoor ${rating.toFixed(1)} / 5${count}${stale}${observed}${method}`;
  }
  appendText(card, "p", ratingText, "rating");
  if (company?.ratingEvidence) appendText(card, "p", `Rating evidence: ${company.ratingEvidence}`, "rating");
  if (company?.identityEvidence) appendText(card, "p", `Company identity: ${company.identityEvidence}`, "rating");
  if (company?.manualOverrideNote) appendText(card, "p", `Manual rating note: ${company.manualOverrideNote}`, "rating");
  appendSafeLink(card, company?.glassdoorProfileUrl, "Glassdoor company profile", "rating");
  if (Array.isArray(company?.ratingSourceUrls)) {
    company.ratingSourceUrls.forEach((url, index) => {
      appendSafeLink(card, url, `Rating source ${index + 1}`, "rating");
    });
  }

  const applyUrl = safeApplicationUrl(job.applyUrl);
  if (applyUrl) {
    const link = document.createElement("a");
    link.className = "apply";
    link.href = applyUrl;
    link.rel = "noopener noreferrer";
    link.textContent = "View and apply";
    card.append(link);
  }
  return card;
}

function formatDate(value) {
  if (typeof value !== "string") return "No successful publication recorded.";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "No successful publication recorded."
    : `Last successful publication: ${date.toLocaleString()}`;
}

function renderSourceChecks(sources) {
  const list = document.querySelector("#source-list");
  if (!list) return;
  const rows = sources.map((source) => {
    const item = document.createElement("li");
    const name = `${String(source.ats).toLocaleUpperCase()} · ${source.boardId}`;
    let status;
    if (source.complete && source.lastSuccessfulAt) {
      status = `complete · ${source.jobCount ?? "?"} source postings · last success ${new Date(source.lastSuccessfulAt).toLocaleString()}`;
    } else if (source.lastSuccessfulAt) {
      status = `latest attempt incomplete · last complete success ${new Date(source.lastSuccessfulAt).toLocaleString()}`;
    } else {
      status = "no complete successful observation";
    }
    item.textContent = `${name}: ${status}`;
    return item;
  });
  list.replaceChildren(...rows);
}

async function initialize() {
  const status = document.querySelector("#load-status");
  const publication = document.querySelector("#publication-time");
  const list = document.querySelector("#jobs");
  const empty = document.querySelector("#empty-state");
  const search = document.querySelector("#search");
  const showClosed = document.querySelector("#show-closed");
  const sort = document.querySelector("#sort");
  let data = null;
  try {
    const url = new URL("./data/jobs.json", document.baseURI);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("not available");
    data = await response.json();
    if (!validatePublicData(data)) throw new Error("invalid data");
  } catch {
    status.textContent = "No validated job data is available yet.";
    publication.textContent = "No successful publication recorded.";
    empty.hidden = false;
    empty.textContent = "This board has not published listings.";
    return;
  }

  const companies = new Map(data.companies.map((company) => [company.id, company]));
  const sources = new Map(data.sources.map((source) => [`${source.ats}:${source.boardId}`, source]));
  renderSourceChecks(data.sources);
  publication.textContent = formatDate(data.lastSuccessfulPublicationAt);
  const render = () => {
    const jobs = filterAndSortJobs(data, search.value, showClosed.checked, sort.value);
    list.replaceChildren(...jobs.map((job) => renderJob(
      job,
      companies.get(job.companyId),
      sources.get(`${job.source}:${job.boardId}`),
    )));
    empty.hidden = jobs.length > 0;
    empty.textContent = data.jobs.length ? "No jobs match your search." : "There are no published listings yet.";
    status.textContent = `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} shown`;
  };
  search.addEventListener("input", render);
  showClosed.addEventListener("change", render);
  sort.addEventListener("change", render);
  render();
}

if (typeof document !== "undefined") initialize();
