/*
  Auckland Transport Card
  Type: custom:auckland-transport-card

  Configuration options:
    - entity (required): sensor entity provided by the integration
    - title (optional): custom title
    - max_rows (optional): override number of rows (defaults to attributes available)
    - show_delay (optional, default true)
    - show_license_plate (optional, default false)
    - show_route (optional, default true)
    - show_headsign (optional, default true)
    - show_times (optional, default true)
*/

/* global customElements, HTMLElement */

const CARD_VERSION = 'v0.1.0';

class AucklandTransportCard extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
  }

  static getConfigElement() {
    return document.createElement('auckland-transport-card-editor');
  }

  static getStubConfig(hass, entities) {
    // First try to find in provided entities list
    let sensor = (entities || []).find((e) => e.startsWith('sensor.auckland_transport'));
    
    // If not found, search all entities in hass
    if (!sensor && hass) {
      const allEntities = Object.keys(hass.states);
      sensor = allEntities.find((e) => e.startsWith('sensor.auckland_transport'));
    }
    
    return { entity: sensor || '' };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Entity is required');
    }
    this._config = {
      title: undefined,
      max_rows: undefined,
      headsign_filter: undefined,
      show_footer_api_break: false,
      show_footer_remaining: false,
      show_footer_filter: false,
      header_icon: undefined,            // e.g. 'mdi:train'
      header_icon_show: true,
      header_icon_color: undefined,      // CSS color or var(--...)
      header_icon_size: 28,             
      header_logo: true,                 
      header_logo_size: 40,              
      show_delay: true,
      show_license_plate: false,
      show_route: true,
      show_headsign: true,
      show_times: true,
      time_format: '24',  // '24' for 24-hour, '12' for 12-hour AM/PM
      ...config,
    };
    this._render();
  }

  getCardSize() {
    const rows = this._extractDepartures().length || 1;
    return Math.min(rows + 1, 7);
  }

  _getEntityState() {
    if (!this._hass || !this._config) return undefined;
    return this._hass.states[this._config.entity];
  }

  _extractDepartures() {
    const stateObj = this._getEntityState();
    if (!stateObj) return [];
    const attrs = stateObj.attributes || {};

    let rows = [];
    const maxRows = Number(this._config.max_rows) || 999;
    let index = 1;
    while (index <= maxRows) {
      const prefix = `departure_${index}`;
      const sched = attrs[`${prefix}_scheduled_time`];
      const actual = attrs[`${prefix}_actual_time`];
      const headsign = attrs[`${prefix}_headsign`];
      const route = attrs[`${prefix}_route`];
      const delay = attrs[`${prefix}_delay_in_seconds`];
      const license = attrs[`${prefix}_license_plate`];

      if (!sched && !actual && !headsign && !route) break;

      rows.push({
        scheduled: sched || null,
        actual: actual || sched || null,
        headsign: headsign || '',
        route: route || '',
        delaySeconds: Number.isFinite(delay) ? delay : (typeof delay === 'number' ? delay : undefined),
        licensePlate: license || undefined,
      });
      index += 1;
    }
    // Apply headsign filter if configured
    const raw = (this._config.headsign_filter || '').toString().trim();
    if (raw) {
      let include = true;
      let pattern = raw;
      if (pattern.startsWith('!')) {
        include = false;
        pattern = pattern.slice(1);
      }
      let tester = (h) => true;
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const last = pattern.lastIndexOf('/');
        const body = pattern.slice(1, last);
        const flags = pattern.slice(last + 1) || 'i';
        try {
          const re = new RegExp(body, flags);
          tester = (h) => re.test(h || '');
        } catch (e) {
          const needle = pattern.toLowerCase();
          tester = (h) => (h || '').toLowerCase().includes(needle);
        }
      } else {
        const needle = pattern.toLowerCase();
        tester = (h) => (h || '').toLowerCase().includes(needle);
      }
      rows = rows.filter((r) => (include ? tester(r.headsign) : !tester(r.headsign)));
    }
    return rows;
  }

  _formatDelay(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) return 'On time';
    if (seconds === 0) return 'On time';
    const absSeconds = Math.abs(seconds);
    const sign = seconds > 0 ? '+' : '';
    if (absSeconds < 60) {
      return `${sign}${Math.round(absSeconds)} sec`;
    }
    const mins = Math.round(absSeconds / 60);
    return `${sign}${mins} min`;
  }

  _formatTime(timeStr) {
    if (!timeStr) return '—';
    // Time string is in format HH:MM:SS or HH:MM
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    
    if (isNaN(hour) || isNaN(minute)) return timeStr;
    
    // 24-hour format (default)
    if (this._config.time_format === '24' || !this._config.time_format) {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    // 12-hour format with AM/PM
    if (this._config.time_format === '12') {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
      return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
    }
    
    // Fallback to 24-hour if invalid format
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }

  _render() {
    if (!this._hass || !this._config) return;

    const stateObj = this._getEntityState();
    const root = this._card || (this._card = document.createElement('ha-card'));

    // Header
    const attrs = stateObj?.attributes || {};
    const stopName = attrs.stop_name || attrs.stop || attrs.ATTR_STOP_NAME || '';
    const stopCode = attrs.stop_code || '';
    const title = this._config.title ?? `${stopName}${stopCode ? ` (${stopCode})` : ''}`;

    // Build content
    const wrapper = document.createElement('div');
    wrapper.style.padding = '0 16px 16px 16px';

    // Inline header row with logo (before title) and icon (after title)
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.padding = '16px 0 8px 0';
    headerRow.style.gap = '8px';

    // Logo before title (independent)
    if (this._config.header_logo) {
      const imgEl = document.createElement('img');
      imgEl.src = 'https://raw.githubusercontent.com/SeitzDaniel/brands/master/custom_integrations/auckland_transport/icon.png';
      imgEl.alt = 'Auckland Transport';
      const logoSize = Number(this._config.header_logo_size) || 40;
      imgEl.style.width = `${logoSize}px`;
      imgEl.style.height = `${logoSize}px`;
      imgEl.style.objectFit = 'contain';
      imgEl.style.flex = '0 0 auto';
      headerRow.appendChild(imgEl);
    }

    const titleEl = document.createElement('div');
    titleEl.textContent = title || 'Auckland Transport';
    titleEl.style.fontSize = 'var(--paper-font-headline6_-_font-size, 16px)';
    titleEl.style.fontWeight = '600';
    titleEl.style.lineHeight = '1.2';
    titleEl.style.margin = '0';
    titleEl.style.flex = '1';
    headerRow.appendChild(titleEl);

    // Icon after title (independent)
    if (this._config.header_icon_show) {
      const iconName = this._config.header_icon || stateObj?.attributes?.icon || 'mdi:transit-connection';
      if (iconName) {
        const iconEl = document.createElement('ha-icon');
        iconEl.setAttribute('icon', iconName);
        const size = Number(this._config.header_icon_size) || 28;
        // Control HA icon size via CSS var for reliability across versions
        iconEl.style.setProperty('--mdc-icon-size', `${size}px`);
        // Back-compat for older icon implementations
        iconEl.style.setProperty('--iron-icon-width', `${size}px`);
        iconEl.style.setProperty('--iron-icon-height', `${size}px`);
        iconEl.style.width = `${size}px`;
        iconEl.style.height = `${size}px`;
        iconEl.style.flex = '0 0 auto';
        if (this._config.header_icon_color) {
          iconEl.style.color = this._config.header_icon_color;
        } else {
          iconEl.style.color = 'var(--primary-text-color)';
        }
        headerRow.appendChild(iconEl);
      }
    }
    wrapper.appendChild(headerRow);

    const departures = this._extractDepartures();

    if (!departures.length) {
      const empty = document.createElement('div');
      empty.style.padding = '12px 0';
      empty.textContent = stateObj ? (stateObj.state || 'No upcoming departures') : 'Entity not found';
      wrapper.appendChild(empty);
      root.innerHTML = '';
      root.appendChild(wrapper);
      if (!this.contains(root)) this.appendChild(root);
      return;
    }

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = 'var(--paper-font-body1_-_font-size, 14px)';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');

    if (this._config.show_route) {
      hr.appendChild(this._th('Route'));
    }
    if (this._config.show_headsign) {
      hr.appendChild(this._th('Destination'));
    }
    if (this._config.show_times) {
      hr.appendChild(this._th('Scheduled'));
      hr.appendChild(this._th('Actual'));
    }
    if (this._config.show_delay) {
      hr.appendChild(this._th('Delay'));
    }
    if (this._config.show_license_plate) {
      hr.appendChild(this._th('L-Plate'));
    }

    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const rows = this._extractDepartures();

    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.style.borderTop = '1px solid var(--divider-color)';

      if (this._config.show_route) {
        tr.appendChild(this._td(r.route || '—'));
      }
      if (this._config.show_headsign) {
        tr.appendChild(this._td(r.headsign || '—'));
      }
      if (this._config.show_times) {
        tr.appendChild(this._td(this._formatTime(r.scheduled)));
        tr.appendChild(this._td(this._formatTime(r.actual)));
      }
      if (this._config.show_delay) {
        const delayText = this._formatDelay(r.delaySeconds);
        const td = this._td(delayText || '');
        if (r.delaySeconds > 0) {
          td.style.color = 'var(--error-color)';
        } else if (r.delaySeconds < 0) {
          // Early (negative delay) shown as orange
          td.style.color = 'var(--warning-color, orange)';
        } else {
          // Treat 0 or missing delay as on time (green)
          td.style.color = 'var(--success-color)';
        }
        tr.appendChild(td);
      }
      if (this._config.show_license_plate) {
        const licensePlateText = r.licensePlate || '—';
        const td = this._td(licensePlateText);
        if (licensePlateText === '—') {
          td.style.textAlign = 'center';
        }
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);

    // Footer badges (optional)
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.marginTop = '8px';
    footer.style.color = 'var(--secondary-text-color)';
    footer.style.fontSize = '12px';

    const apiBreakStart = attrs.start_of_API_break;
    const apiBreakEnd = attrs.end_of_API_break;
    const apiDisabled = attrs.API_currently_disabled;

    if (this._config.show_footer_api_break && apiBreakStart && apiBreakEnd) {
      const left = document.createElement('div');
      left.textContent = `API break ${apiBreakStart} - ${apiBreakEnd}${apiDisabled ? ' (now)' : ''}`;
      footer.appendChild(left);
    }

    const remaining = attrs.remaining_departures_for_today;
    if (this._config.show_footer_remaining && Number.isFinite(remaining)) {
      const right = document.createElement('div');
      right.textContent = `${remaining} Remaining departures for today`;
      footer.appendChild(right);
    }

    // Show active headsign filter
    const filter = (this._config.headsign_filter || '').toString().trim();
    if (this._config.show_footer_filter && filter) {
      const f = document.createElement('div');
      f.style.marginLeft = 'auto';
      f.textContent = `Filter: ${filter}`;
      footer.appendChild(f);
    }

    if (footer.children.length) wrapper.appendChild(footer);

    root.innerHTML = '';
    root.appendChild(wrapper);
    if (!this.contains(root)) this.appendChild(root);
  }

  _th(text) {
    const th = document.createElement('th');
    th.style.textAlign = 'left';
    th.style.padding = '12px 8px';
    th.style.fontWeight = '600';
    th.textContent = text;
    return th;
  }

  _td(text) {
    const td = document.createElement('td');
    td.style.padding = '8px';
    td.textContent = text;
    return td;
  }
}

customElements.define('auckland-transport-card', AucklandTransportCard);

class AucklandTransportCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    if (!this._content) {
      this._createCard();
    }
    this._updateValues();
  }

  set hass(hass) {
    this._hass = hass;
    const entityPicker = this.shadowRoot?.querySelector('ha-entity-picker');
    if (entityPicker) {
      entityPicker.hass = hass;
    }
  }

  _createCard() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this._render();
    this._content = true;
  }

  _updateVisibility() {
    if (!this.shadowRoot || !this._config) return;
    
    const root = this.shadowRoot;
    const config = this._config;
    
    // Show/hide logo size based on header_logo switch
    const logoSizeField = root.getElementById('logo-size-field');
    if (logoSizeField) {
      logoSizeField.style.display = config.header_logo !== false ? 'block' : 'none';
    }
    
    // Show/hide icon fields based on header_icon_show switch
    const iconPickerField = root.getElementById('icon-picker-field');
    const iconSizeField = root.getElementById('icon-size-field');
    const iconColorField = root.getElementById('icon-color-field');
    if (iconPickerField) {
      iconPickerField.style.display = config.header_icon_show !== false ? 'block' : 'none';
    }
    if (iconSizeField) {
      iconSizeField.style.display = config.header_icon_show !== false ? 'block' : 'none';
    }
    if (iconColorField) {
      iconColorField.style.display = config.header_icon_show !== false ? 'block' : 'none';
    }
    
    // Show/hide filter indicator based on whether headsign_filter has a value
    const filterIndicatorField = root.getElementById('filter-indicator-field');
    if (filterIndicatorField) {
      const hasFilter = config.headsign_filter && config.headsign_filter.toString().trim() !== '';
      filterIndicatorField.style.display = hasFilter ? 'block' : 'none';
    }
  }

  _updateValues() {
    if (!this.shadowRoot || !this._config) return;
    
    const config = this._config;
    const root = this.shadowRoot;
    
    // Update entity select value
    const entitySelect = root.getElementById('entity-select');
    if (entitySelect) {
      entitySelect.value = config.entity || '';
    }
    
    root.querySelectorAll('ha-textfield[configValue]').forEach((el) => {
      const key = el.getAttribute('configValue');
      if (key === 'title') el.value = config.title || '';
      if (key === 'max_rows') el.value = config.max_rows || '';
      if (key === 'header_logo_size') el.value = config.header_logo_size || 40;
      if (key === 'header_icon_size') el.value = config.header_icon_size || 28;
      if (key === 'header_icon_color') el.value = config.header_icon_color || '';
      if (key === 'headsign_filter') el.value = config.headsign_filter || '';
    });

    root.querySelectorAll('ha-switch[configValue]').forEach((el) => {
      const key = el.getAttribute('configValue');
      if (key === 'header_logo') el.checked = config.header_logo !== false;
      if (key === 'header_icon_show') el.checked = config.header_icon_show !== false;
      if (key === 'show_route') el.checked = config.show_route !== false;
      if (key === 'show_headsign') el.checked = config.show_headsign !== false;
      if (key === 'show_times') el.checked = config.show_times !== false;
      if (key === 'time_format_24h') el.checked = config.time_format !== '12';
      if (key === 'show_delay') el.checked = config.show_delay !== false;
      if (key === 'show_license_plate') el.checked = config.show_license_plate === true;
      if (key === 'show_footer_api_break') el.checked = config.show_footer_api_break === true;
      if (key === 'show_footer_remaining') el.checked = config.show_footer_remaining === true;
      if (key === 'show_footer_filter') el.checked = config.show_footer_filter === true;
    });

    const iconPicker = root.querySelector('ha-icon-picker[configValue="header_icon"]');
    if (iconPicker) {
      iconPicker.value = config.header_icon || '';
    }
    
    // Update visibility of conditional fields
    this._updateVisibility();
  }

  _render() {
    const root = this.shadowRoot;
    
    root.innerHTML = `
      <style>
        .card-config {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .section-title {
          font-weight: 600;
          font-size: 14px;
          margin-top: 8px;
          margin-bottom: 4px;
        }
        ha-textfield, ha-select, ha-icon-picker, #entity-select {
          width: 100%;
        }
        ha-switch {
          padding: 8px 0;
        }
      </style>
      <div class="card-config">
        <div class="section">
          <ha-select
            id="entity-select"
            label="Entity (required)"
            configValue="entity"
            fixedMenuPosition
            naturalMenuWidth
            required
          >
          </ha-select>
          <ha-textfield
            label="Title (optional)"
            configValue="title"
          ></ha-textfield>
          <ha-textfield
            label="Max rows (optional)"
            type="number"
            configValue="max_rows"
          ></ha-textfield>
        </div>

        <div class="section">
          <div class="section-title">Header Options</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch
              configValue="header_logo"
              id="header-logo-switch"
            ></ha-switch>
            <span>Show Logo</span>
          </div>
          <ha-textfield
            label="Logo size (px)"
            type="number"
            configValue="header_logo_size"
            id="logo-size-field"
          ></ha-textfield>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch
              configValue="header_icon_show"
              id="header-icon-switch"
            ></ha-switch>
            <span>Show Icon</span>
          </div>
          <ha-icon-picker
            label="Header icon (optional)"
            configValue="header_icon"
            id="icon-picker-field"
          ></ha-icon-picker>
          <ha-textfield
            label="Icon size (px)"
            type="number"
            configValue="header_icon_size"
            id="icon-size-field"
          ></ha-textfield>
          <ha-textfield
            label="Icon color (optional)"
            configValue="header_icon_color"
            placeholder="e.g. var(--primary-color)"
            id="icon-color-field"
          ></ha-textfield>
        </div>

        <div class="section">
          <div class="section-title">Display Options</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_route"></ha-switch>
            <span>Show Route</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_headsign"></ha-switch>
            <span>Show Destination</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_times"></ha-switch>
            <span>Show Times</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
          <ha-switch configValue="show_delay"></ha-switch>
          <span>Show Delay</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
          <ha-switch configValue="show_license_plate"></ha-switch>
          <span>Show License Plate</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">Time Format</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="time_format_24h"></ha-switch>
            <span>24-hours</span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Filter Options</div>
          <ha-textfield
            label="Headsign filter (optional)"
            configValue="headsign_filter"
            placeholder="e.g. To Britomart"
            helper="Filter trips by destination. You can use plain text"
          ></ha-textfield>
        </div>

        <div class="section">
          <div class="section-title">Footer Options</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_footer_api_break"></ha-switch>
            <span>Show API break window</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_footer_remaining"></ha-switch>
            <span>Show remaining departures count</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;" id="filter-indicator-field">
            <ha-switch configValue="show_footer_filter"></ha-switch>
            <span>Show active filter indicator</span>
          </div>
        </div>
      </div>
    `;

    // Populate entity select with Auckland Transport sensor entities
    const entitySelect = root.getElementById('entity-select');
    if (entitySelect && this._hass) {
      const sensorEntities = Object.keys(this._hass.states).filter((id) => id.startsWith('sensor.auckland_transport'));
      entitySelect.innerHTML = sensorEntities.map((entity) => 
        `<mwc-list-item value="${entity}">${entity}</mwc-list-item>`
      ).join('');
      entitySelect.value = this._config.entity || '';
      entitySelect.addEventListener('selected', (ev) => {
        ev.stopPropagation();
        this._updateConfig('entity', ev.target.value);
      });
      entitySelect.addEventListener('closed', (e) => e.stopPropagation());
    }

    root.querySelectorAll('ha-textfield[configValue]').forEach((el) => {
      el.addEventListener('input', (ev) => {
        this._valueChanged(ev);
        // Update visibility when headsign_filter changes
        if (el.getAttribute('configValue') === 'headsign_filter') {
          this._updateVisibility();
        }
      });
    });

    root.querySelectorAll('ha-switch[configValue]').forEach((el) => {
      el.addEventListener('change', (ev) => {
        this._valueChanged(ev);
        this._updateVisibility();
      });
    });

    const iconPicker = root.querySelector('ha-icon-picker[configValue="header_icon"]');
    if (iconPicker) {
      iconPicker.addEventListener('value-changed', (ev) => {
        ev.target.configValue = 'header_icon';
        this._valueChanged(ev);
      });
    }
  }

  _updateConfig(key, value) {
    if (!this._config) return;
    
    const newConfig = { ...this._config };
    
    if (value === '' || value === undefined || value === null) {
      delete newConfig[key];
    } else {
      newConfig[key] = value;
    }
    
    this._config = newConfig;
    
    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _valueChanged(ev) {
    if (!this._config) return;
    const target = ev.target;
    const configValue = target.getAttribute('configValue') || target.configValue;
    if (!configValue) return;
    
    let value = target.value;

    if (target.type === 'number') {
      value = value === '' ? undefined : Number(value);
    } else if (target.tagName === 'HA-SWITCH') {
      // Special handling for time_format_24h switch
      if (configValue === 'time_format_24h') {
        this._updateConfig('time_format', target.checked ? '24' : '12');
        return;
      }
      value = target.checked;
    } else if (target.tagName === 'HA-SELECT') {
      value = target.value || ev.detail?.item?.value;
    } else if (target.tagName === 'HA-ICON-PICKER') {
      value = target.value || undefined;
    }

    this._updateConfig(configValue, value);
  }
}

customElements.define('auckland-transport-card-editor', AucklandTransportCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'auckland-transport-card',
  name: 'Auckland Transport',
  description: 'Card for the Auckland Transport integration',
  preview: true,
});

console.info(
  `%c Auckland Transport Card %c v${CARD_VERSION} `,
  'background: #0d47a1; color: #fff; border-radius: 3px 0 0 3px; padding: 2px 4px;',
  'background: #1976d2; color: #fff; border-radius: 0 3px 3px 0; padding: 2px 4px;'
);