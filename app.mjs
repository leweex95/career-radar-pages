const WORKPLACE_LABELS = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "Unspecified",
};

const GEOGRAPHY_LABELS = {
  match: "EU match",
  uncertain: "Uncertain",
  excluded: "Outside EU",
};

export const TABLE_COLUMNS = [
  { key: "company", label: "Company" },
  { key: "title", label: "Position" },
  { key: "source", label: "Source board" },
  { key: "location", label: "Location" },
  { key: "workplace", label: "Work style" },
  { key: "geography", label: "EU eligibility" },
  { key: "salary", label: "Salary" },
  { key: "rating", label: "Glassdoor" },
  { key: "status", label: "Status" },
  { key: "sourceFreshness", label: "Source last succeeded" },
  { key: "roleFit", label: "Career Radar fit" },
];

export function safeApplicationUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value, globalThis.location?.href ?? "https://example.invalid/");
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function validatePublicData(data) {
  const isJobRecord = (job) => Boolean(
    job && typeof job === "object" && typeof job.id === "string" && typeof job.title === "string"
    && typeof job.companyId === "string" && typeof job.source === "string" && typeof job.boardId === "string"
    && typeof job.descriptionText === "string" && typeof job.salaryOriginal !== "undefined"
  );
  return Boolean(
    data && typeof data === "object" && !Array.isArray(data)
    && data.schemaVersion === 3
    && Array.isArray(data.jobs)
    && Array.isArray(data.collectedJobs)
    && Array.isArray(data.companies)
    && Array.isArray(data.sources)
    && data.jobs.every(isJobRecord)
    && data.collectedJobs.every(isJobRecord)
    && data.companies.every((company) => company && typeof company.id === "string")
    && data.sources.every((source) => source && typeof source.ats === "string" && typeof source.boardId === "string")
  );
}

function mapsFor(data) {
  return {
    companies: new Map(data.companies.map((company) => [company.id, company])),
    sources: new Map(data.sources.map((source) => [`${source.ats}:${source.boardId}`, source])),
  };
}

export function columnValue(job, maps, key) {
  const company = maps.companies.get(job.companyId);
  const source = maps.sources.get(`${job.source}:${job.boardId}`);
  switch (key) {
    case "company": return company?.name ?? "";
    case "title": return job.title ?? "";
    case "source": return `${job.source ?? ""}:${job.boardId ?? ""}`;
    case "location": return job.locationOriginal ?? "";
    case "workplace": return job.workplace ?? "unknown";
    case "geography": return job.geographyDecision ?? "uncertain";
    case "salary": return job.salaryOriginal ?? null;
    case "rating":
      return typeof company?.glassdoorRating === "number" && Number.isFinite(company.glassdoorRating)
        ? company.glassdoorRating : null;
    case "status": return job.status ?? "unknown";
    case "roleFit": return ({ strong: 3, adjacent: 2, not_relevant: 1, not_screened: 0 })[job.roleFit] ?? -1;
    case "sourceFreshness": {
      const parsed = Date.parse(source?.lastSuccessfulAt ?? "");
      return Number.isFinite(parsed) ? parsed : null;
    }
    default: return null;
  }
}

export function filterJobs(data, filters = {}, collection = data?.jobs) {
  if (!validatePublicData(data)) return [];
  if (!Array.isArray(collection)) return [];
  const maps = mapsFor(data);
  const query = String(filters.query ?? "").trim().toLocaleLowerCase();
  const salaryQuery = String(filters.salary ?? "").trim().toLocaleLowerCase();
  const minimumRating = filters.minimumRating === "" || filters.minimumRating == null
    ? null : Number(filters.minimumRating);

  return collection.filter((job) => {
    const company = maps.companies.get(job.companyId);
    const source = maps.sources.get(`${job.source}:${job.boardId}`);
    const rating = columnValue(job, maps, "rating");
    if (job.status === "closed" && !filters.showClosed && filters.status !== "closed") return false;
    if (filters.company && job.companyId !== filters.company) return false;
    if (filters.source && `${job.source}:${job.boardId}` !== filters.source) return false;
    if (filters.workplace && job.workplace !== filters.workplace) return false;
    if (filters.geography && job.geographyDecision !== filters.geography) return false;
    if (filters.status && job.status !== filters.status) return false;
    if (filters.roleFit && job.roleFit !== filters.roleFit) return false;
    if (filters.rating === "known" && rating == null) return false;
    if (filters.rating === "unknown" && rating != null) return false;
    if (minimumRating != null && (!Number.isFinite(minimumRating) || rating == null || rating < minimumRating)) return false;
    if (salaryQuery && !String(job.salaryOriginal ?? "").toLocaleLowerCase().includes(salaryQuery)) return false;
    if (query) {
      const searchable = [
        company?.name, job.title, job.descriptionText, job.locationOriginal,
        job.salaryOriginal, job.workplace, job.geographyDecision, job.status,
        job.roleFit, job.roleFitReason, ...(Array.isArray(job.roleFitEvidence) ? job.roleFitEvidence : []),
        job.source, job.boardId, company?.ratingEvidence, company?.identityEvidence,
      ].filter((value) => typeof value === "string").join(" ").toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
}

export function filterCollectedJobs(data, filters = {}) {
  return filterJobs(data, { showClosed: true, ...filters }, data?.collectedJobs);
}

function isUnknown(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function sortJobs(data, jobs, sortKey = "title", direction = "asc") {
  if (!validatePublicData(data)) return [];
  const maps = mapsFor(data);
  const multiplier = direction === "desc" ? -1 : 1;
  return [...jobs].sort((left, right) => {
    const leftValue = columnValue(left, maps, sortKey);
    const rightValue = columnValue(right, maps, sortKey);
    const leftUnknown = isUnknown(leftValue);
    const rightUnknown = isUnknown(rightValue);
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    if (!leftUnknown) {
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
      if (comparison !== 0) return comparison * multiplier;
    }
    return String(left.title).localeCompare(String(right.title), undefined, { sensitivity: "base" })
      || String(left.id).localeCompare(String(right.id));
  });
}

// Backwards-compatible helper for simple consumers/tests.
export function filterAndSortJobs(data, query = "", showClosed = false, sortBy = "rating") {
  const direction = sortBy === "rating" ? "desc" : "asc";
  return sortJobs(data, filterJobs(data, { query, showClosed }), sortBy, direction);
}

function appendText(parent, tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text ?? "");
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
  link.target = "_blank";
  link.textContent = label;
  parent.append(link);
  return link;
}

function renderGlassdoorRating(parent, company, rating) {
  const profileUrl = safeApplicationUrl(company?.glassdoorProfileUrl);
  const link = document.createElement(profileUrl ? "a" : "span");
  link.className = profileUrl ? "glassdoor-rating-link" : "glassdoor-rating-text";
  if (profileUrl) {
    link.href = profileUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Verify ${company.name} on Glassdoor: ${rating.toFixed(1)} out of 5${Number.isInteger(company.reviewCount) ? `, ${company.reviewCount.toLocaleString()} reviews` : ""}`);
  }
  appendText(link, "span", `${rating.toFixed(1)} / 5`, "glassdoor-rating-score");
  if (Number.isInteger(company?.reviewCount)) {
    appendText(link, "span", `(${company.reviewCount.toLocaleString()} reviews)`, "glassdoor-review-count");
  }
  parent.append(link);
}

function formatDate(value) {
  if (typeof value !== "string") return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Not recorded" : date.toLocaleString();
}

function formatColumn(job, maps, key) {
  const company = maps.companies.get(job.companyId);
  const value = columnValue(job, maps, key);
  switch (key) {
    case "workplace": return WORKPLACE_LABELS[job.workplace] ?? WORKPLACE_LABELS.unknown;
    case "source": return `${String(job.source || "").toLocaleUpperCase()} · ${job.boardId || "Unknown"}`;
    case "geography": return GEOGRAPHY_LABELS[job.geographyDecision] ?? "Uncertain";
    case "salary": return job.salaryOriginal || "Not listed";
    case "rating": {
      if (value == null) return "Not rated";
      return `${value.toFixed(1)} / 5`;
    }
    case "status": return ({ active: "Active", pending_absence: "Pending", closed: "Closed" })[job.status] ?? "Unknown";
    case "roleFit": return ({ strong: "Strong match", adjacent: "Product-adjacent", not_relevant: "Not a match", not_screened: "Not screened" })[job.roleFit] ?? "Not screened";
    case "sourceFreshness": {
      const source = maps.sources.get(`${job.source}:${job.boardId}`);
      return source?.lastSuccessfulAt ? formatDate(source.lastSuccessfulAt) : "Unknown";
    }
    default: return String(value || (key === "location" ? "Not specified" : "?"));
  }
}

function renderSourceChecks(sources) {
  const list = document.querySelector("#source-list");
  if (!list) return;
  const rows = sources.map((source) => {
    const item = document.createElement("li");
    const label = `${String(source.ats).toLocaleUpperCase()} ? ${source.boardId}`;
    let status;
    if (source.complete && source.lastSuccessfulAt) {
      status = `Complete ? ${source.jobCount ?? "?"} source postings ? ${formatDate(source.lastSuccessfulAt)}`;
    } else if (source.lastSuccessfulAt) {
      status = `Latest attempt incomplete ? last complete success ${formatDate(source.lastSuccessfulAt)}`;
    } else {
      status = "No complete successful observation";
    }
    item.textContent = `${label}: ${status}`;
    return item;
  });
  list.replaceChildren(...rows);
}

function addDetailField(parent, label, value) {
  const item = document.createElement("div");
  item.className = "detail-field";
  appendText(item, "dt", label);
  appendText(item, "dd", value || "Not provided");
  parent.append(item);
}

function renderDetails(job, company, source) {
  const content = document.createElement("div");
  content.className = "detail-content";
  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  addDetailField(grid, "Job ID", job.id);
  addDetailField(grid, "Location as listed", job.locationOriginal);
  addDetailField(grid, "Source workplace label", job.sourceWorkplaceType);
  addDetailField(grid, "Source remote flag", job.sourceIsRemote === null ? null : String(job.sourceIsRemote));
  addDetailField(grid, "Interpreted work style", WORKPLACE_LABELS[job.workplace] ?? "Unspecified");
  addDetailField(grid, "Workplace evidence", job.workplaceEvidence);
  addDetailField(grid, "EU eligibility", GEOGRAPHY_LABELS[job.geographyDecision] ?? "Uncertain");
  addDetailField(grid, "Eligibility evidence", job.geographyEvidence);
  addDetailField(grid, "Geography decision basis", job.geographyReason);
  addDetailField(grid, "Salary as published", job.salaryOriginal);
  addDetailField(grid, "Status", ({ active: "Active", pending_absence: "Pending review", closed: "Closed" })[job.status] ?? "Unknown");
  addDetailField(grid, "Closure reason", job.closureReason);
  addDetailField(grid, "Source", `${job.source} ? ${job.boardId}`);
  addDetailField(grid, "Last complete source observation", source?.lastSuccessfulAt ? formatDate(source.lastSuccessfulAt) : null);
  addDetailField(grid, "Career Radar fit", ({ strong: "Strong match", adjacent: "Product-adjacent", not_relevant: "Not a match", not_screened: "Not screened" })[job.roleFit] ?? "Not screened");
  addDetailField(grid, "Role family", job.roleFamily?.replaceAll("_", " "));
  addDetailField(grid, "Fit rationale", job.roleFitReason);
  addDetailField(grid, "Fit evidence", Array.isArray(job.roleFitEvidence) ? job.roleFitEvidence.join("\n\n") : null);
  content.append(grid);

  const description = document.createElement("section");
  description.className = "detail-description";
  appendText(description, "h3", "Full description");
  appendText(description, "p", job.descriptionText, "description-text");
  content.append(description);

  const links = document.createElement("div");
  links.className = "detail-links";
  appendSafeLink(links, job.applyUrl, "Open application", "primary-link");
  appendSafeLink(links, job.jobUrl, "Open source posting", "secondary-link");
  appendSafeLink(links, company?.website, "Company website", "secondary-link");
  appendSafeLink(links, company?.glassdoorProfileUrl, "Glassdoor profile", "secondary-link");
  content.append(links);

  if (company?.glassdoorRating != null) {
    const rating = document.createElement("section");
    rating.className = "rating-evidence";
    appendText(rating, "h3", `Glassdoor ${Number(company.glassdoorRating).toFixed(1)} / 5`);
    if (Number.isInteger(company.reviewCount)) appendText(rating, "p", `${company.reviewCount.toLocaleString()} reviews`);
    appendText(rating, "p", `Provenance: ${company.ratingSource || "Not recorded"}`);
    appendText(rating, "p", company.ratingEvidence || "Rating evidence not provided.");
    appendText(rating, "p", company.identityEvidence || "Company identity evidence not provided.");
    if (company.ratingObservedAt) appendText(rating, "p", `Observed ${formatDate(company.ratingObservedAt)} — ${company.ratingFreshness}`);
    if (company.manualOverrideNote) appendText(rating, "p", `Manual note: ${company.manualOverrideNote}`);
    if (Array.isArray(company.ratingSourceUrls)) {
      company.ratingSourceUrls.forEach((url, index) => appendSafeLink(rating, url, `Rating source ${index + 1}`, "secondary-link"));
    }
    content.append(rating);
  }
  return content;
}

function initialize() {
  const publication = document.querySelector("#publication-time");
  if (!publication) return;
  const filterNames = ["query", "company", "source", "workplace", "geography", "status", "salary", "rating", "minimumRating", "showClosed", "roleFit"];
  const defaultFilters = () => ({ query: "", company: "", source: "", workplace: "", geography: "", status: "", salary: "", rating: "", minimumRating: "", showClosed: false, roleFit: "" });
  const views = {
    shortlist: { collection: "jobs", filters: defaultFilters(), sortKey: "title", direction: "asc", expanded: new Set() },
    collected: { collection: "collectedJobs", filters: { ...defaultFilters(), showClosed: true }, sortKey: "title", direction: "asc", expanded: new Set() },
  };
  const controls = Object.fromEntries(Object.keys(views).map((name) => [name, Object.fromEntries(
    filterNames.map((key) => [key, document.querySelector(`#${name}-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)]),
  )]));

  function updateFilters(name) {
    for (const key of filterNames) {
      const control = controls[name][key];
      if (control) views[name].filters[key] = control.type === "checkbox" ? control.checked : control.value;
    }
    renderTable(name);
  }

  for (const name of Object.keys(views)) {
    for (const control of Object.values(controls[name])) {
      control?.addEventListener("input", () => updateFilters(name));
      control?.addEventListener("change", () => updateFilters(name));
    }
    document.querySelector(`#${name}-clear-filters`)?.addEventListener("click", () => {
      for (const control of Object.values(controls[name])) {
        if (!control) continue;
        if (control.type === "checkbox") control.checked = false;
        else control.value = "";
      }
      updateFilters(name);
    });
    const tbody = document.querySelector(`#${name}-job-rows`);
    tbody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-job]");
      if (!button) return;
      const id = button.dataset.openJob;
      if (views[name].expanded.has(id)) views[name].expanded.delete(id);
      else views[name].expanded.add(id);
      renderTable(name);
      [...tbody.querySelectorAll("[data-open-job]")].find((item) => item.dataset.openJob === id)?.focus();
    });
  }

  document.querySelectorAll("button[data-sort-key][data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = views[button.dataset.view];
      if (!current) return;
      const key = button.dataset.sortKey;
      if (current.sortKey === key) current.direction = current.direction === "asc" ? "desc" : "asc";
      else {
        current.sortKey = key;
        current.direction = key === "rating" || key === "sourceFreshness" ? "desc" : "asc";
      }
      renderTable(button.dataset.view);
    });
  });

  document.querySelectorAll("[data-tab-target]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const selected = tab.dataset.tabTarget;
      document.querySelectorAll("[data-tab-target]").forEach((candidate) => {
        const active = candidate === tab;
        candidate.setAttribute("aria-selected", active ? "true" : "false");
        candidate.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
        panel.hidden = panel.id !== `${selected}-panel`;
      });
    });
  });

  function populateFilters(data) {
    for (const name of Object.keys(views)) {
      const companyFilter = controls[name].company;
      const sourceFilter = controls[name].source;
      for (const company of [...data.companies].sort((a, b) => a.name.localeCompare(b.name))) {
        const option = document.createElement("option");
        option.value = company.id;
        option.textContent = company.name;
        companyFilter?.append(option);
      }
      for (const source of data.sources) {
        const option = document.createElement("option");
        option.value = `${source.ats}:${source.boardId}`;
        option.textContent = `${source.ats.toLocaleUpperCase()} · ${source.boardId}`;
        sourceFilter?.append(option);
      }
    }
    renderSourceChecks(data.sources);
    publication.textContent = formatDate(data.lastSuccessfulPublicationAt) === "Not recorded"
      ? "No successful publication recorded."
      : `Last successful publication: ${formatDate(data.lastSuccessfulPublicationAt)}`;
    const collectedCount = document.querySelector("#collected-count");
    if (collectedCount) collectedCount.textContent = `${data.collectedJobs.length.toLocaleString()} collected postings`;
  }

  function renderTable(name) {
    const data = appState.data;
    const current = views[name];
    const tbody = document.querySelector(`#${name}-job-rows`);
    const status = document.querySelector(`#${name}-load-status`);
    if (!data || !current || !tbody || !status) return;
    const maps = mapsFor(data);
    const collection = data[current.collection];
    const filtered = filterJobs(data, current.filters, collection);
    const sorted = sortJobs(data, filtered, current.sortKey, current.direction);
    const rows = [];
    for (const job of sorted) {
      const row = document.createElement("tr");
      row.dataset.jobId = job.id;
      for (const column of TABLE_COLUMNS) {
        const cell = document.createElement("td");
        const value = formatColumn(job, maps, column.key);
        if (column.key === "rating" || column.key === "roleFit") cell.className = value === "Not rated" || value === "Not screened" ? "muted-cell" : "rating-cell";
        if (column.key === "status") cell.className = `status-cell status-${job.status}`;
        if (column.key === "geography") cell.className = `geo-cell geo-${job.geographyDecision}`;
        if (column.key === "title") cell.className = "title-cell";
        if (column.key === "rating" && value !== "Not rated") {
          renderGlassdoorRating(cell, maps.companies.get(job.companyId), columnValue(job, maps, "rating"));
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      }
      const actionCell = document.createElement("td");
      actionCell.className = "details-action";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "detail-toggle";
      open.dataset.openJob = job.id;
      open.setAttribute("aria-expanded", current.expanded.has(job.id) ? "true" : "false");
      open.textContent = current.expanded.has(job.id) ? "Hide details" : "View details";
      actionCell.append(open);
      row.append(actionCell);
      rows.push(row);
      if (current.expanded.has(job.id)) {
        const detailRow = document.createElement("tr");
        detailRow.className = "detail-row";
        const cell = document.createElement("td");
        cell.colSpan = TABLE_COLUMNS.length + 1;
        cell.append(renderDetails(job, maps.companies.get(job.companyId), maps.sources.get(`${job.source}:${job.boardId}`)));
        detailRow.append(cell);
        rows.push(detailRow);
      }
    }
    if (!sorted.length) {
      const empty = document.createElement("tr");
      empty.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = TABLE_COLUMNS.length + 1;
      cell.textContent = collection.length === 0
        ? (name === "collected" ? "No postings have been collected from the configured boards yet." : "No AI product or product-adjacent roles have been screened into the shortlist yet. See All collected postings.")
        : "No positions match these filters. Choose Clear filters to reset this table.";
      empty.append(cell);
      rows.push(empty);
    }
    tbody.replaceChildren(...rows);
    const tableName = name === "collected" ? "collected postings" : "shortlist positions";
    status.textContent = `Showing ${sorted.length.toLocaleString()} of ${collection.length.toLocaleString()} ${tableName} · sorted by ${TABLE_COLUMNS.find((column) => column.key === current.sortKey)?.label ?? current.sortKey} (${current.direction === "asc" ? "ascending" : "descending"})`;
    document.querySelectorAll(`button[data-sort-key][data-view="${name}"]`).forEach((button) => {
      const header = button.closest("th");
      const active = button.dataset.sortKey === current.sortKey;
      header?.setAttribute("aria-sort", active ? (current.direction === "asc" ? "ascending" : "descending") : "none");
      const indicator = button.querySelector(".sort-indicator");
      if (indicator) indicator.textContent = active ? (current.direction === "asc" ? "↑" : "↓") : "↕";
    });
  }

  const appState = { data: null };
  const url = new URL("./data/jobs.json", document.baseURI);
  fetch(url, { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("public data unavailable");
      return response.json();
    })
    .then((data) => {
      if (!validatePublicData(data)) throw new Error("public data failed schema validation");
      appState.data = data;
      populateFilters(data);
      renderTable("shortlist");
      renderTable("collected");
    })
    .catch(() => {
      publication.textContent = "No successful publication recorded.";
      for (const name of Object.keys(views)) {
        const status = document.querySelector(`#${name}-load-status`);
        const tbody = document.querySelector(`#${name}-job-rows`);
        if (status) status.textContent = "Validated job data is currently unavailable.";
        const empty = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = TABLE_COLUMNS.length + 1;
        cell.textContent = "The public data file could not be loaded or did not pass validation.";
        empty.append(cell);
        tbody?.replaceChildren(empty);
      }
    });
}

if (typeof document !== "undefined") initialize();
