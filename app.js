const form = document.getElementById("searchForm");
const timeline = document.getElementById("timeline");
const emptyState = document.getElementById("emptyState");
const emptyTitle = document.getElementById("emptyTitle");
const emptyMessage = document.getElementById("emptyMessage");
const webSearchLink = document.getElementById("webSearchLink");
const resultMeta = document.getElementById("resultMeta");
const resultsTitle = document.getElementById("resultsTitle");
const locationInput = document.getElementById("location");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const radarLoader = document.getElementById("radarLoader");
const timelineReplayButton = document.getElementById("timelineReplayButton");
let currentEvents = [];
let activeFilter = "all";
let searchSequence = 0;
const searchCache = new Map();
let selectedMarker;
let selectedRipple;
let selectionRequest = 0;
let replayInterval = null;
let replayRows = [];
let replayIndex = 0;

const today = new Date();
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate() - 6);
const toDateInput = date => date.toISOString().slice(0, 10);
startDateInput.value = toDateInput(weekAgo);
endDateInput.value = toDateInput(today);

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return {
    day: new Intl.DateTimeFormat("en", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("en", { month: "short" }).format(date),
    year: new Intl.DateTimeFormat("en", { year: "numeric" }).format(date)
  };
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value == null ? "" : String(value);
  return span.innerHTML;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function resetTimelineReplay() {
  if (replayInterval !== null) clearInterval(replayInterval);
  replayInterval = null;
  timeline.classList.remove("replaying");
  timeline.querySelectorAll(".replay-current").forEach(row => row.classList.remove("replay-current"));
  timeline.style.setProperty("--playhead-progress", "0");
  replayRows = [];
  replayIndex = 0;
  timelineReplayButton.setAttribute("aria-pressed", "false");
  timelineReplayButton.querySelector(".replay-label").textContent = "Replay timeline";
}

function renderEvents(events) {
  const visible = activeFilter === "all"
    ? events
    : events.filter(event => event.category === activeFilter);

  resetTimelineReplay();
  timeline.replaceChildren();
  emptyState.hidden = visible.length > 0;
  timelineReplayButton.disabled = visible.length === 0;

  visible.forEach(event => {
    const date = formatDate(event.date);
    const article = document.createElement("article");
    article.className = "event-row";
    article.innerHTML = `
      <div class="event-date">
        <strong>${date.day}</strong>
        <span>${date.month} ${date.year}</span>
      </div>
      <div class="event-card">
        <div>
          <span class="event-type">${escapeHtml(event.type)}</span>
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(event.location)} · ${escapeHtml(event.description)}</p>
        </div>
        <div class="event-actions">
          <span class="source-count">Bing News feed</span>
          <a class="source-link" href="${safeUrl(event.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.sourceName || "View source")}</a>
        </div>
      </div>`;
    timeline.appendChild(article);
  });

  if (visible.length > 0) {
    const playhead = document.createElement("div");
    playhead.className = "timeline-playhead";
    playhead.setAttribute("aria-hidden", "true");
    timeline.appendChild(playhead);
    const sourceTotal = new Set(visible.map(event => event.sourceName).filter(Boolean)).size;
    resultMeta.textContent = `${visible.length} reports · ${sourceTotal} outlet${sourceTotal === 1 ? "" : "s"} · Bing News`;
  } else if (events.length > 0) {
    resultMeta.textContent = "No reports match this filter";
  }
}

function getPlaceName(address, fallback) {
  const parts = [
    address.city, address.town, address.village, address.municipality,
    address.county, address.state, address.province, address.country
  ].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : fallback;
}

function showWebSearchFallback(location, startDate, endDate, keyword) {
  const newsSearch = new URL("https://news.google.com/search");
  const query = [location, keyword].filter(Boolean).join(" ");
  newsSearch.searchParams.set("q", `${query} after:${startDate} before:${endDate}`);
  newsSearch.searchParams.set("hl", "en-US");
  newsSearch.searchParams.set("gl", "US");
  newsSearch.searchParams.set("ceid", "US:en");
  webSearchLink.href = newsSearch.href;
  webSearchLink.hidden = false;
}

async function reverseGeocode(latlng) {
  const detail = map.getZoom() < 5 ? 3 : map.getZoom() < 8 ? 5 : 10;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${detail}&lat=${encodeURIComponent(latlng.lat)}&lon=${encodeURIComponent(latlng.lng)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Could not resolve this map location.");
  const data = await response.json();
  if (!data.address) throw new Error("No place name was returned for this location.");
  return getPlaceName(data.address, data.display_name);
}

function showLocationPopup(latlng, initialPlace) {
  const popup = document.createElement("form");
  popup.className = "map-popup";

  const heading = document.createElement("strong");
  heading.className = "popup-place";
  heading.textContent = initialPlace || "Finding this place…";
  popup.appendChild(heading);

  const placeLabel = document.createElement("label");
  placeLabel.textContent = "Place or country";
  const placeInput = document.createElement("input");
  placeInput.type = "text";
  placeInput.required = true;
  placeInput.value = initialPlace || "";
  placeInput.placeholder = "City, region, or country";
  placeLabel.appendChild(placeInput);
  popup.appendChild(placeLabel);

  const dates = document.createElement("div");
  dates.className = "popup-dates";
  [
    ["From", startDateInput.value],
    ["To", endDateInput.value]
  ].forEach(([labelText, value]) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "date";
    input.required = true;
    input.value = value;
    input.setAttribute("aria-label", labelText);
    label.appendChild(input);
    dates.appendChild(label);
  });
  popup.appendChild(dates);

  const popupError = document.createElement("span");
  popupError.className = "popup-error";
  popupError.setAttribute("role", "status");
  popup.appendChild(popupError);
  const popupLayer = L.popup({ maxWidth: 280, minWidth: 250 })
    .setLatLng(latlng)
    .setContent(popup);

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "popup-submit";
  button.textContent = "Show timeline";
  popup.appendChild(button);

  popup.addEventListener("submit", event => {
    event.preventDefault();
    const [popupStart, popupEnd] = dates.querySelectorAll("input");
    if (popupStart.value > popupEnd.value) {
      popupError.textContent = "End date must be on or after the start date.";
      return;
    }
    locationInput.value = placeInput.value.trim();
    startDateInput.value = popupStart.value;
    endDateInput.value = popupEnd.value;
    map.closePopup();
    performSearch(locationInput.value, popupStart.value, popupEnd.value);
  });

  map.openPopup(popupLayer);
  if (!initialPlace) {
    const requestId = ++selectionRequest;
    reverseGeocode(latlng).then(place => {
      if (requestId !== selectionRequest || !map.hasLayer(popupLayer)) return;
      heading.textContent = place;
      placeInput.value = place;
      locationInput.value = place;
      performSearch(place, startDateInput.value, endDateInput.value);
    }).catch(error => {
      if (requestId !== selectionRequest || !map.hasLayer(popupLayer)) return;
      heading.textContent = "Could not identify place";
      placeInput.placeholder = "Enter a place or country";
      placeInput.focus();
      popupError.textContent = error.message;
    });
  }
}

const map = L.map("map", {
  center: [25, 12],
  zoom: 2,
  minZoom: 2,
  worldCopyJump: true,
  scrollWheelZoom: true
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
}).addTo(map);

map.on("click", event => {
  if (selectedMarker) map.removeLayer(selectedMarker);
  if (selectedRipple) map.removeLayer(selectedRipple);
  selectedRipple = L.circleMarker(event.latlng, {
    className: "selected-location-ripple",
    radius: 8,
    color: "#ff5269",
    weight: 2,
    fillOpacity: 0,
    interactive: false
  }).addTo(map);
  selectedMarker = L.circleMarker(event.latlng, {
    className: "selected-location-pulse",
    radius: 8,
    color: "#f2f0e9",
    weight: 3,
    fillColor: "#61784d",
    fillOpacity: 1
  }).addTo(map);
  const latlng = event.latlng;
  setTimeout(() => showLocationPopup(latlng), 0);
});

async function searchPublicSources(location, startDate, endDate, keyword) {
  const query = [location, keyword].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q: query, format: "rss", mkt: "en-US" });
  const today = toDateInput(new Date());
  const daysAgo = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
  const interval = daysAgo >= 0 && daysAgo < 7 ? "7"
    : daysAgo < 30 && daysAgo >= 0 ? "30"
    : daysAgo < 365 && daysAgo >= 0 ? "365"
    : null;
  if (interval) params.set("qft", `interval="${interval}"`);
  const isLocalPreview = window.location.protocol === "file:"
    || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const feedUrl = isLocalPreview
    ? `https://www.bing.com/news/search?${params}`
    : `/.netlify/functions/bing-news?${params}`;
  const response = await fetch(feedUrl);
  if (!response.ok) {
    const message = !isLocalPreview && response.headers.get("content-type")?.startsWith("text/plain")
      ? (await response.text()).trim()
      : "";
    throw new Error(message || `Bing News search returned HTTP ${response.status}.`);
  }

  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Bing News returned an unreadable feed.");

  return [...xml.querySelectorAll("item")]
    .map(item => {
      const getText = name => item.querySelector(name)?.textContent?.trim() || "";
      const source = [...item.children].find(child => child.localName.toLowerCase() === "source")?.textContent.trim();
      const published = Date.parse(getText("pubDate"));
      if (!Number.isFinite(published)) return null;

      const date = new Date(published).toISOString().slice(0, 10);
      let url = getText("link");
      try {
        const bingLink = new URL(url);
        const originalUrl = bingLink.searchParams.get("url");
        if (bingLink.hostname.endsWith("bing.com") && originalUrl) url = originalUrl;
      } catch {
        return null;
      }

      return {
        title: getText("title"),
        date,
        location,
        description: getText("description") || "Public news report indexed by Bing News.",
        type: "News report",
        category: "news",
        sourceName: source || new URL(url).hostname.replace(/^www\./, ""),
        url
      };
    })
    .filter(article => article && article.title && safeUrl(article.url) !== "#")
    .filter(article => article.date >= startDate && article.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function performSearch(location, startDate, endDate, scrollToResults = true) {
  if (!location || !startDate || !endDate) return;
  if (startDate > endDate) {
    alert("The end date must be on or after the start date.");
    return;
  }

  const searchId = ++searchSequence;
  const keyword = document.getElementById("keyword").value.trim();
  const cacheKey = [location, startDate, endDate, keyword].join("|").toLowerCase();
  const cached = searchCache.get(cacheKey);
  const cachedEvents = cached && Date.now() - cached.savedAt < 60000 ? cached.events : null;
  const minimumLoaderMs = 2000 + Math.floor(Math.random() * 4001);
  const searchStartedAt = performance.now();

  resetTimelineReplay();
  currentEvents = [];
  timelineReplayButton.disabled = true;
  timeline.replaceChildren();
  webSearchLink.hidden = true;
  emptyState.hidden = false;
  radarLoader.hidden = false;
  emptyTitle.textContent = cachedEvents ? "Preparing recent reports" : "Searching public news";
  emptyMessage.textContent = cachedEvents ? "Getting your timeline ready…" : "Searching Bing News for public reports…";
  resultsTitle.textContent = location;
  resultMeta.textContent = cachedEvents ? "Loading recent results…" : "Searching Bing News…";

  const button = form.querySelector(".search-button");
  button.classList.add("loading");
  button.disabled = true;
  button.querySelector("span").textContent = "Searching";

  try {
    const events = cachedEvents || await searchPublicSources(location, startDate, endDate, keyword);
    if (searchId !== searchSequence) return;
    const remainingLoaderMs = minimumLoaderMs - (performance.now() - searchStartedAt);
    if (remainingLoaderMs > 0) {
      emptyTitle.textContent = "Preparing your timeline";
      emptyMessage.textContent = "Organizing reports by date and source…";
      resultMeta.textContent = "Preparing timeline…";
      await new Promise(resolve => window.setTimeout(resolve, remainingLoaderMs));
      if (searchId !== searchSequence) return;
    }
    currentEvents = events;
    if (!cachedEvents) searchCache.set(cacheKey, { events: currentEvents, savedAt: Date.now() });
    renderEvents(currentEvents);
    if (currentEvents.length === 0) {
      emptyTitle.textContent = "No matching reports found";
      emptyMessage.textContent = "Bing News returned no reports for this place and date range. Try broader dates or search the web directly.";
      resultMeta.textContent = "0 reports · Bing News";
      showWebSearchFallback(location, startDate, endDate, keyword);
    }
  } catch (error) {
    if (searchId !== searchSequence) return;
    console.error(error);
    emptyTitle.textContent = "Could not load reports";
    emptyMessage.textContent = error.message || "The public news search is unavailable right now. Check your connection and try again.";
    resultMeta.textContent = "Search unavailable";
    showWebSearchFallback(location, startDate, endDate, keyword);
  } finally {
    if (searchId === searchSequence) {
      radarLoader.hidden = true;
      button.classList.remove("loading");
      button.disabled = false;
      button.querySelector("span").textContent = "Search";
    }
  }

  if (searchId === searchSequence && scrollToResults) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector(".results-section").scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start"
    });
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  performSearch(locationInput.value.trim(), startDateInput.value, endDateInput.value);
});

document.querySelectorAll(".quick-place, .globe-node").forEach(button => {
  button.addEventListener("click", () => {
    locationInput.value = button.dataset.quickLocation;
    form.requestSubmit();
  });
});

const heroVisual = document.getElementById("heroVisual");
const globeStage = document.getElementById("globeStage");

heroVisual.addEventListener("pointermove", event => {
  if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = heroVisual.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
  const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
  globeStage.style.setProperty("--globe-tilt-x", `${-y * 8}deg`);
  globeStage.style.setProperty("--globe-tilt-y", `${x * 11}deg`);
});

heroVisual.addEventListener("pointerleave", () => {
  globeStage.style.setProperty("--globe-tilt-x", "0deg");
  globeStage.style.setProperty("--globe-tilt-y", "0deg");
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderEvents(currentEvents);
  });
});

function advanceTimelineReplay() {
  if (replayIndex >= replayRows.length) {
    clearInterval(replayInterval);
    replayInterval = null;
    timelineReplayButton.setAttribute("aria-pressed", "false");
    timelineReplayButton.querySelector(".replay-label").textContent = "Replay again";
    return;
  }

  const row = replayRows[replayIndex];
  timeline.querySelectorAll(".replay-current").forEach(item => item.classList.remove("replay-current"));
  row.classList.add("replay-current");
  timeline.style.setProperty("--playhead-progress", String((replayIndex + 1) / replayRows.length));
  replayIndex += 1;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
}

timelineReplayButton.addEventListener("click", () => {
  if (replayInterval !== null) {
    clearInterval(replayInterval);
    replayInterval = null;
    timelineReplayButton.setAttribute("aria-pressed", "false");
    timelineReplayButton.querySelector(".replay-label").textContent = "Resume replay";
    return;
  }

  if (replayRows.length === 0 || replayIndex >= replayRows.length) {
    replayRows = [...timeline.querySelectorAll(".event-row")];
    replayIndex = 0;
    replayRows.forEach(row => row.classList.remove("replay-current"));
    timeline.style.setProperty("--playhead-progress", "0");
  }
  if (replayRows.length === 0) return;

  timeline.classList.add("replaying");
  timelineReplayButton.setAttribute("aria-pressed", "true");
  timelineReplayButton.querySelector(".replay-label").textContent = "Pause replay";
  replayInterval = window.setInterval(advanceTimelineReplay, 1600);
  advanceTimelineReplay();
});

const dialog = document.getElementById("methodDialog");
document.getElementById("methodButton").addEventListener("click", () => dialog.showModal());
dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});

const exploreTab = document.getElementById("exploreTab");
const infoTab = document.getElementById("infoTab");
const explorePanel = document.getElementById("explorePanel");
const infoPanel = document.getElementById("infoPanel");
const appTabs = [exploreTab, infoTab];

function selectTab(selectedTab) {
  const showInfo = selectedTab === infoTab;
  if (showInfo) resetTimelineReplay();
  exploreTab.setAttribute("aria-selected", String(!showInfo));
  infoTab.setAttribute("aria-selected", String(showInfo));
  exploreTab.tabIndex = showInfo ? -1 : 0;
  infoTab.tabIndex = showInfo ? 0 : -1;
  exploreTab.classList.toggle("active", !showInfo);
  infoTab.classList.toggle("active", showInfo);
  explorePanel.hidden = showInfo;
  infoPanel.hidden = !showInfo;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  if (!showInfo) requestAnimationFrame(() => map.invalidateSize());
}

appTabs.forEach(tab => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? appTabs.length - 1
      : (appTabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : appTabs.length - 1)) % appTabs.length;
    appTabs[nextIndex].focus();
    selectTab(appTabs[nextIndex]);
  });
});

const policyTabs = [
  document.getElementById("overviewPolicyTab"),
  document.getElementById("privacyPolicyTab"),
  document.getElementById("termsPolicyTab"),
  document.getElementById("cookiesPolicyTab")
];

function selectPolicyTab(selectedTab) {
  policyTabs.forEach(tab => {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.classList.toggle("active", selected);
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
}

policyTabs.forEach(tab => {
  tab.addEventListener("click", () => selectPolicyTab(tab));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabIndex = policyTabs.indexOf(tab);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? policyTabs.length - 1
      : (tabIndex + (event.key === "ArrowRight" ? 1 : policyTabs.length - 1)) % policyTabs.length;
    policyTabs[nextIndex].focus();
    selectPolicyTab(policyTabs[nextIndex]);
  });
});

emptyState.hidden = false;
