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
  { key: "location", label: "Location" },
  { key: "workplace", label: "Work style" },
  { key: "geography", label: "EU eligibility" },
  { key: "salary", label: "Salary" },
  { key: "rating", label: "Glassdoor" },
  { key: "status", label: "Status" },
  { key: "sourceFreshness", label: "Source last succeeded" },
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
  return Boolean(
    data && typeof data === "object" && !Array.isArray(data)
    && data.schemaVersion === 1
    && Array.isArray(data.jobs)
    && Array.isArray(data.companies)
    && Array.isArray(data.sources)
    && data.jobs.every((job) => job && typeof job.id === "string" && typeof job.title === "string")
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
    case "location": return job.locationOriginal ?? "";
    case "workplace": return job.workplace ?? "unknown";
    case "geography": return job.geographyDecision ?? "uncertain";
    case "salary": return job.salaryOriginal ?? null;
    case "rating":
      return typeof company?.glassdoorRating === "number" && Number.isFinite(company.glassdoorRating)
        ? company.glassdoorRating : null;
    case "status": return job.status ?? "unknown";
    case "sourceFreshness": {
      const parsed = Date.parse(source?.lastSuccessfulAt ?? "");
      return Number.isFinite(parsed) ? parsed : null;
    }
    default: return null;
  }
}

export function filterJobs(data, filters = {}) {
  if (!validatePublicData(data)) return [];
  const maps = mapsFor(data);
  const query = String(filters.query ?? "").trim().toLocaleLowerCase();
  const salaryQuery = String(filters.salary ?? "").trim().toLocaleLowerCase();
  const minimumRating = filters.minimumRating === "" || filters.minimumRating == null
    ? null : Number(filters.minimumRating);

  return data.jobs.filter((job) => {
    const company = maps.companies.get(job.companyId);
    const source = maps.sources.get(`${job.source}:${job.boardId}`);
    const rating = columnValue(job, maps, "rating");
    if (job.status === "closed" && !filters.showClosed && filters.status !== "closed") return false;
    if (filters.company && job.companyId !== filters.company) return false;
    if (filters.source && `${job.source}:${job.boardId}` !== filters.source) return false;
    if (filters.workplace && job.workplace !== filters.workplace) return false;
    if (filters.geography && job.geographyDecision !== filters.geography) return false;
    if (filters.status && job.status !== filters.status) return false;
    if (filters.rating === "known" && rating == null) return false;
    if (filters.rating === "unknown" && rating != null) return false;
    if (minimumRating != null && (!Number.isFinite(minimumRating) || rating == null || rating < minimumRating)) return false;
    if (salaryQuery && !String(job.salaryOriginal ?? "").toLocaleLowerCase().includes(salaryQuery)) return false;
    if (query) {
      const searchable = [
        company?.name, job.title, job.descriptionText, job.locationOriginal,
        job.salaryOriginal, job.workplace, job.geographyDecision, job.status,
        job.source, job.boardId, company?.ratingEvidence, company?.identityEvidence,
      ].filter((value) => typeof value === "string").join(" ").toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
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
    case "geography": return GEOGRAPHY_LABELS[job.geographyDecision] ?? "Uncertain";
    case "salary": return job.salaryOriginal || "Not listed";
    case "rating": {
      if (value == null) return "Not rated";
      const count = Number.isInteger(company?.reviewCount) ? ` ? ${company.reviewCount.toLocaleString()} reviews` : "";
      return `${value.toFixed(1)} / 5${count}`;
    }
    case "status": return ({ active: "Active", pending_absence: "Pending", closed: "Closed" })[job.status] ?? "Unknown";
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
  addDetailField(grid, "Workplace evidence", job.workplace);
  addDetailField(grid, "EU eligibility", GEOGRAPHY_LABELS[job.geographyDecision] ?? "Uncertain");
  addDetailField(grid, "Eligibility evidence", job.geographyEvidence);
  addDetailField(grid, "Salary as published", job.salaryOriginal);
  addDetailField(grid, "Status", ({ active: "Active", pending_absence: "Pending review", closed: "Closed" })[job.status] ?? "Unknown");
  addDetailField(grid, "Closure reason", job.closureReason);
  addDetailField(grid, "Source", `${job.source} ? ${job.boardId}`);
  addDetailField(grid, "Last complete source observation", source?.lastSuccessfulAt ? formatDate(source.lastSuccessfulAt) : null);
  content.append(grid);

  const description = document.createElement("section");
  description.className = "detail-description";
  appendText(description, "h3", "Full description");
  appendText(description, "p", job.descriptionText, "description-text");
  content.append(description);

  const links = document.createElement("div");
  links.className = "detail-links";
  appendSafeLink(links, job.applyUrl, "Open application", "primary-link");
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
  const status = document.querySelector("#load-status");
  const publication = document.querySelector("#publication-time");
  const tbody = document.querySelector("#job-rows");
  const sourceList = document.querySelector("#source-list");
  if (!status || !publication || !tbody) return;

  const state = {
    data: null,
    filters: { query: "", company: "", source: "", workplace: "", geography: "", status: "", salary: "", rating: "", minimumRating: "", showClosed: false },
    sortKey: "title",
    direction: "asc",
    expanded: new Set(),
  };
  const controls = {
    query: document.querySelector("#search"),
    company: document.querySelector("#company-filter"),
    source: document.querySelector("#source-filter"),
    workplace: document.querySelector("#workplace-filter"),
    geography: document.querySelector("#geography-filter"),
    status: document.querySelector("#status-filter"),
    salary: document.querySelector("#salary-filter"),
    rating: document.querySelector("#rating-filter"),
    minimumRating: document.querySelector("#minimum-rating"),
    showClosed: document.querySelector("#show-closed"),
  };

  const updateFilters = () => {
    for (const key of Object.keys(controls)) {
      const control = controls[key];
      if (!control) continue;
      state.filters[key] = control.type === "checkbox" ? control.checked : control.value;
    }
    renderTable(state);
  };
  for (const control of Object.values(controls)) {
    control?.addEventListener("input", updateFilters);
    control?.addEventListener("change", updateFilters);
  }

  document.querySelector("#clear-filters")?.addEventListener("click", () => {
    for (const control of Object.values(controls)) {
      if (!control) continue;
      if (control.type === "checkbox") control.checked = false;
      else control.value = "";
    }
    updateFilters();
  });

  document.querySelectorAll("button[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sortKey;
      if (state.sortKey === key) state.direction = state.direction === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.direction = key === "rating" || key === "sourceFreshness" ? "desc" : "asc";
      }
      renderTable(state);
    });
  });

  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-job]");
    if (!button) return;
    const id = button.dataset.openJob;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    renderTable(state);
    [...tbody.querySelectorAll("[data-open-job]")].find((item) => item.dataset.openJob === id)?.focus();
  });

  function populateFilters(data) {
    const companyFilter = controls.company;
    const sourceFilter = controls.source;
    if (companyFilter) {
      const companies = [...data.companies].sort((a, b) => a.name.localeCompare(b.name));
      for (const company of companies) {
        const option = document.createElement("option");
        option.value = company.id;
        option.textContent = company.name;
        companyFilter.append(option);
      }
    }
    if (sourceFilter) {
      for (const source of data.sources) {
        const option = document.createElement("option");
        option.value = `${source.ats}:${source.boardId}`;
        option.textContent = `${source.ats.toLocaleUpperCase()} ? ${source.boardId}`;
        sourceFilter.append(option);
      }
    }
    renderSourceChecks(data.sources);
    publication.textContent = formatDate(data.lastSuccessfulPublicationAt) === "Not recorded"
      ? "No successful publication recorded."
      : `Last successful publication: ${formatDate(data.lastSuccessfulPublicationAt)}`;
  }

  function renderTable(current) {
    const data = current.data;
    if (!data) return;
    const maps = mapsFor(data);
    const filtered = filterJobs(data, current.filters);
    const sorted = sortJobs(data, filtered, current.sortKey, current.direction);
    const rows = [];

    for (const job of sorted) {
      const row = document.createElement("tr");
      row.dataset.jobId = job.id;
      for (const column of TABLE_COLUMNS) {
        const cell = document.createElement("td");
        const value = formatColumn(job, maps, column.key);
        if (column.key === "rating") cell.className = value === "Not rated" ? "muted-cell" : "rating-cell";
        if (column.key === "status") cell.className = `status-cell status-${job.status}`;
        if (column.key === "geography") cell.className = `geo-cell geo-${job.geographyDecision}`;
        if (column.key === "title") cell.className = "title-cell";
        cell.textContent = value;
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
        const details = document.createElement("tr");
        details.className = "detail-row";
        const cell = document.createElement("td");
        cell.colSpan = TABLE_COLUMNS.length + 1;
        const company = maps.companies.get(job.companyId);
        const source = maps.sources.get(`${job.source}:${job.boardId}`);
        cell.append(renderDetails(job, company, source));
        details.append(cell);
        rows.push(details);
      }
    }

    if (sorted.length === 0) {
      const empty = document.createElement("tr");
      empty.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = TABLE_COLUMNS.length + 1;
      cell.textContent = data.jobs.length === 0
        ? "No matching AI Product Manager positions were found in the latest source observations. Source checks are listed below."
        : "No positions match the current filters. Choose Clear filters to reset the table.";
      empty.append(cell);
      rows.push(empty);
    }
    tbody.replaceChildren(...rows);
    status.textContent = `Showing ${sorted.length} of ${data.jobs.length} positions ? sorted by ${TABLE_COLUMNS.find((column) => column.key === current.sortKey)?.label ?? current.sortKey} (${current.direction === "asc" ? "ascending" : "descending"})`;

    document.querySelectorAll("[data-sort-key]").forEach((button) => {
      const header = button.closest("th");
      const active = button.dataset.sortKey === current.sortKey;
      header?.setAttribute("aria-sort", active ? (current.direction === "asc" ? "ascending" : "descending") : "none");
      const indicator = button.querySelector(".sort-indicator");
      if (indicator) indicator.textContent = active ? (current.direction === "asc" ? "?" : "?") : "?";
    });
  }

  const url = new URL("./data/jobs.json", document.baseURI);
  fetch(url, { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("public data unavailable");
      return response.json();
    })
    .then((data) => {
      if (!validatePublicData(data)) throw new Error("public data failed schema validation");
      state.data = data;
      populateFilters(data);
      renderTable(state);
    })
    .catch(() => {
      status.textContent = "Validated job data is currently unavailable.";
      publication.textContent = "No successful publication recorded.";
      if (sourceList) sourceList.replaceChildren();
      const empty = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = TABLE_COLUMNS.length + 1;
      cell.textContent = "The public data file could not be loaded or did not pass validation.";
      empty.append(cell);
      tbody.replaceChildren(empty);
    });
}

if (typeof document !== "undefined") initialize();
