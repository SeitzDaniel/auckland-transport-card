/*
  Auckland Transport Card
  Type: custom:auckland-transport-card

  Configuration options:
    - entity (required): sensor entity provided by the integration
    - title (optional): custom title
    - max_rows (optional): override number of rows (defaults to attributes available)
    - show_delay (optional, default true)
    - show_license_plate (optional, default false)
    - show_direction (optional, default false): show an arriving/departing icon per row
    - arriving_icon (optional, default 'mdi:location-enter')
    - departing_icon (optional, default 'mdi:location-exit')
    - arriving_color (optional): CSS color for arriving icon (default green)
    - departing_color (optional): CSS color for departing icon (default blue)
    - show_route (optional, default true)
    - show_headsign (optional, default true)
    - show_times (optional, default true)
    - show_map (optional, default false)
*/

/* global customElements, HTMLElement */

const CARD_VERSION = 'v0.3.1';

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
      filter: undefined,
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
      show_direction: false,                 // show arriving/departing icon column
      arriving_icon: 'mdi:location-enter',   // icon for trips terminating at this stop
      departing_icon: 'mdi:location-exit',   // icon for trips originating/continuing
      arriving_color: undefined,             // override arriving icon color (CSS color or var)
      departing_color: undefined,            // override departing icon color (CSS color or var)
      show_route: true,
      show_headsign: true,
      show_times: true,
      time_format: '24',  // '24' for 24-hour, '12' for 12-hour AM/PM
      show_map: false,    // Show vehicle location map
      map_zoom: 14,       // Default map zoom level
      map_marker_type: 'icon',  // 'icon' or 'name' - determines what to show on map marker
      map_marker_icon: undefined,  // Custom MDI icon for map marker (when map_marker_type is 'icon')
      map_marker_name: undefined,  // Custom friendly name for map marker (when map_marker_type is 'name')
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

  _getVehicleLocationEntity() {
    if (!this._hass || !this._config) return undefined;
    // Find the vehicle location sensor based on the main entity
    const mainEntity = this._config.entity;
    if (!mainEntity) return undefined;
    
    // Replace the main sensor name with vehicle location sensor name
    // e.g., sensor.auckland_transport_stop_name -> sensor.auckland_transport_stop_name_vehicle_location
    const vehicleLocationEntity = mainEntity.replace(/^(sensor\.auckland_transport_[^_]+(?:_[^_]+)*)$/, '$1_vehicle_location');
    
    return this._hass.states[vehicleLocationEntity];
  }

  async _createMapCard(config, hass) {
    await customElements.whenDefined('hui-map-card');
    const mapCard = document.createElement('hui-map-card');
    mapCard.setConfig(config);
    mapCard.hass = hass;
    return mapCard;
  }

  _extractDepartures(applyMaxRows = true) {
    const stateObj = this._getEntityState();
    if (!stateObj) return [];
    const attrs = stateObj.attributes || {};

    let rows = [];
    // Read all available departures first (no limit yet)
    let index = 1;
    while (true) {
      const prefix = `departure_${index}`;
      const sched = attrs[`${prefix}_scheduled_time`];
      const actual = attrs[`${prefix}_actual_time`];
      const headsign = attrs[`${prefix}_headsign`];
      const route = attrs[`${prefix}_route`];
      const delay = attrs[`${prefix}_delay_in_seconds`];
      const license = attrs[`${prefix}_license_plate`];
      const pickupType = attrs[`${prefix}_pickup_type`];

      if (!sched && !actual && !headsign && !route) break;

      rows.push({
        scheduled: sched || null,
        actual: actual || sched || null,
        headsign: headsign || '',
        route: route || '',
        delaySeconds: Number.isFinite(delay) ? delay : (typeof delay === 'number' ? delay : undefined),
        licensePlate: license || undefined,
        tripId: attrs[`${prefix}_trip_id`] || undefined,
        direction: this._computeDirection(pickupType, headsign, attrs.stop_name || attrs.stop || ''),
      });
      index += 1;
    }
    // Apply filter if configured (checks both route and headsign)
    const filterRaw = (this._config.filter || '').toString().trim();
    if (filterRaw) {
      rows = this._applyFilter(rows, filterRaw);
    }
    // Apply max_rows limit after filtering (only if requested)
    if (applyMaxRows) {
      const maxRows = Number(this._config.max_rows);
      if (maxRows && maxRows > 0) {
        rows = rows.slice(0, maxRows);
      }
    }
    return rows;
  }

  _applyFilter(rows, filterString) {
    // Split by semicolon to support multiple filters (OR logic)
    const patterns = filterString.split(';').map(p => p.trim()).filter(p => p);
    
    if (patterns.length === 0) return rows;
    
    // For each pattern, determine if it's include or exclude
    const filters = patterns.map(pattern => {
      let include = true;
      let patternStr = pattern;
      if (patternStr.startsWith('!')) {
        include = false;
        patternStr = patternStr.slice(1);
      }
      
      let tester = (value) => true;
      // Check if it's a regex pattern
      if (patternStr.startsWith('/') && patternStr.lastIndexOf('/') > 0) {
        const last = patternStr.lastIndexOf('/');
        const body = patternStr.slice(1, last);
        const flags = patternStr.slice(last + 1) || 'i';
        try {
          const re = new RegExp(body, flags);
          tester = (value) => re.test(value || '');
        } catch (e) {
          // Fallback to plain text if regex fails
          const needle = patternStr.toLowerCase();
          tester = (value) => (value || '').toLowerCase().includes(needle);
        }
      } else {
        // Plain text matching (case-insensitive)
        const needle = patternStr.toLowerCase();
        tester = (value) => (value || '').toLowerCase().includes(needle);
      }
      
      return { include, tester };
    });
    
    // Apply filters: check both route and headsign fields
    return rows.filter((row) => {
      const includeFilters = filters.filter(f => f.include);
      const excludeFilters = filters.filter(f => !f.include);
      
      // If there are include filters, at least one must match (in either route or headsign)
      const includeMatch = includeFilters.length === 0 || 
        includeFilters.some(f => f.tester(row.route) || f.tester(row.headsign));
      
      // If there are exclude filters, none should match (in either route or headsign)
      const excludeMatch = excludeFilters.length === 0 || 
        !excludeFilters.some(f => f.tester(row.route) || f.tester(row.headsign));
      
      return includeMatch && excludeMatch;
    });
  }

  _computeDirection(pickupType, headsign, stopName) {
    // 1. Authoritative GTFS signal, if the integration exposes pickup_type.
    //    pickup_type === 1 means "no boarding here" -> the service terminates
    //    at this stop -> it is arriving. Anything else is boardable -> departing.
    if (pickupType === 1 || pickupType === '1') return 'arriving';
    if (pickupType === 0 || pickupType === '0') return 'departing';

    // 2. Fallback heuristic for integrations that don't yet expose pickup_type:
    //    a trip whose final destination is THIS stop is terminating here.
    const dest = this._headsignDestination(headsign);
    const core = this._stopCoreName(stopName);
    if (!dest || !core) return undefined; // can't tell -> render no icon
    return dest.toLowerCase().includes(core.toLowerCase()) ? 'arriving' : 'departing';
  }

  _headsignDestination(headsign) {
    // Headsigns look like "Pukekohe 1 To Brit 4 Via NKT 2, Papakura 3".
    // The destination is the text after the last " To " and before " Via ".
    if (!headsign) return '';
    let s = headsign;
    const toIdx = s.toLowerCase().lastIndexOf(' to ');
    if (toIdx >= 0) s = s.slice(toIdx + 4);
    const viaIdx = s.toLowerCase().indexOf(' via ');
    if (viaIdx >= 0) s = s.slice(0, viaIdx);
    return s.replace(/\s+\d+\s*$/, '').trim(); // drop trailing platform number
  }

  _stopCoreName(stopName) {
    // Reduce "Pukekohe Train Station" -> "Pukekohe" for matching against a headsign.
    if (!stopName) return '';
    return stopName
      .replace(/\b(train|bus|ferry|station|stop|terminal|interchange|wharf|platform|depot)\b/gi, '')
      .replace(/\s+\d+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
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

    // Get departures first
    const departures = this._extractDepartures();

    // Map display (shown when show_map is enabled in config)
    if (this._config.show_map) {
      const stateObj = this._getEntityState();
      const vehicleLocationState = this._getVehicleLocationEntity();
      
      if (stateObj && departures.length > 0) {
        // Get the trip_id from the first departure in the filtered table
        const firstDepartureTripId = departures[0].tripId;
        
        const mapContainer = document.createElement('div');
        mapContainer.style.marginBottom = '16px';
        mapContainer.style.borderRadius = '8px';
        mapContainer.style.overflow = 'hidden';
        mapContainer.style.border = '1px solid var(--divider-color)';
        
        // Determine what to show on the map
        let mapEntities = [];
        let infoText = '';
        let showVehicle = false;
        
        if (vehicleLocationState && firstDepartureTripId) {
          const vehicleTripId = vehicleLocationState.attributes.trip_id;
          const latitude = vehicleLocationState.attributes.latitude;
          const longitude = vehicleLocationState.attributes.longitude;
          
          if (vehicleTripId === firstDepartureTripId && latitude && longitude) {
            // Trip IDs match and GPS available - show vehicle
            mapEntities = [vehicleLocationState.entity_id];
            showVehicle = true;
            
            const routeId = departures[0].route || '';
            const headsign = departures[0].headsign || '';
            const licensePlate = vehicleLocationState.attributes.license_plate || '';
            
            infoText = `📍 Route: ${routeId}`;
            if (headsign) infoText += ` | Destination: ${headsign}`;
            if (licensePlate) infoText += ` | Vehicle: ${licensePlate}`;
          } else if (!latitude || !longitude) {
            // GPS coordinates not available
            const routeId = departures[0].route || '';
            const headsign = departures[0].headsign || '';
            infoText = `⚠️ GPS coordinates not available for Route ${routeId}`;
            if (headsign) infoText += ` to ${headsign}`;
          } else {
            // Trip IDs don't match
            const routeId = departures[0].route || '';
            const headsign = departures[0].headsign || '';
            infoText = `⚠️ Vehicle location tracking different trip. Showing Route ${routeId}`;
            if (headsign) infoText += ` to ${headsign}`;
            infoText += ` (not currently tracked)`;
          }
        } else {
          // Vehicle location sensor not available
          const routeId = departures[0].route || '';
          const headsign = departures[0].headsign || '';
          infoText = `⚠️ Vehicle tracking unavailable for Route ${routeId}`;
          if (headsign) infoText += ` to ${headsign}`;
        }
        
        // Add stop location to map if we're not showing vehicle
        if (!showVehicle && stateObj.attributes.stop_lat && stateObj.attributes.stop_lon) {
          // Show the stop location instead
          mapEntities = [this._config.entity];
        }
        
        // Configure the map card
        const mapConfig = {
          type: 'map',
          entities: mapEntities.map(entityId => {
            // Apply marker customization based on map_marker_type
            if (this._config.map_marker_type === 'name') {
              // Use name/label for marker
              const entityConfig = { 
                entity: entityId,
                label_mode: 'name'
              };
              // Override with custom friendly name if provided
              if (this._config.map_marker_name) {
                entityConfig.name = this._config.map_marker_name;
              }
              return entityConfig;
            } else {
              // Icon mode - show the entity's icon on the marker
              const entityConfig = {
                entity: entityId,
                label_mode: 'icon'
              };
              return entityConfig;
            }
          }),
          default_zoom: this._config.map_zoom || 14,
          aspect_ratio: '16:9',
          dark_mode: false,
        };
        
        // Override entity icon if custom icon is specified
        // This needs to be done by modifying the hass object temporarily
        let modifiedHass = this._hass;
        if (this._config.map_marker_icon && this._config.map_marker_type !== 'name' && mapEntities.length > 0) {
          // Create a shallow copy of hass with modified entity states
          modifiedHass = {
            ...this._hass,
            states: {
              ...this._hass.states
            }
          };
          
          // Override the icon for each entity in the map
          mapEntities.forEach(entityId => {
            if (modifiedHass.states[entityId]) {
              modifiedHass.states[entityId] = {
                ...modifiedHass.states[entityId],
                attributes: {
                  ...modifiedHass.states[entityId].attributes,
                  icon: this._config.map_marker_icon
                }
              };
            }
          });
        }
        
        // Create map card asynchronously
        this._createMapCard(mapConfig, modifiedHass).then(mapCard => {
          mapContainer.appendChild(mapCard);
        }).catch(() => {
          // Silently fail if map can't be created
        });
        
        // Add info bar below map
        const vehicleInfo = document.createElement('div');
        vehicleInfo.style.padding = '8px 12px';
        vehicleInfo.style.backgroundColor = 'var(--secondary-background-color)';
        vehicleInfo.style.fontSize = '12px';
        vehicleInfo.style.color = showVehicle ? 'var(--secondary-text-color)' : 'var(--warning-color, orange)';
        vehicleInfo.textContent = infoText;
        mapContainer.appendChild(vehicleInfo);
        
        wrapper.appendChild(mapContainer);
      }
    }


    if (!departures.length) {
      const empty = document.createElement('div');
      empty.style.padding = '12px 0';
      empty.textContent = stateObj ? 'No upcoming departures' : 'Entity not found';
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

    if (this._config.show_direction) {
      hr.appendChild(this._th(''));
    }
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

      if (this._config.show_direction) {
        const td = document.createElement('td');
        td.style.padding = '8px';
        td.style.textAlign = 'center';
        td.style.width = '1%';
        if (r.direction) {
          const icon = document.createElement('ha-icon');
          icon.setAttribute(
            'icon',
            r.direction === 'arriving' ? this._config.arriving_icon : this._config.departing_icon
          );
          icon.title = r.direction === 'arriving' ? 'Arriving' : 'Departing';
          icon.style.setProperty('--mdc-icon-size', '20px');
          icon.style.color =
            r.direction === 'arriving'
              ? (this._config.arriving_color || 'var(--success-color, #2e7d32)')
              : (this._config.departing_color || 'var(--info-color, #2196f3)');
          td.appendChild(icon);
        }
        tr.appendChild(td);
      }
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

    // Show remaining departures count
    if (this._config.show_footer_remaining) {
      const right = document.createElement('div');
      // If filter is active, count filtered departures (without max_rows limit)
      const filter = (this._config.filter || '').toString().trim();
      if (filter) {
        const totalFilteredCount = this._extractDepartures(false).length;
        right.textContent = `${totalFilteredCount} Remaining departures for today`;
      } else {
        // Otherwise use the sensor attribute
        const remaining = attrs.remaining_departures_for_today;
        if (Number.isFinite(remaining)) {
          right.textContent = `${remaining} Remaining departures for today`;
        }
      }
      if (right.textContent) {
        footer.appendChild(right);
      }
    }

    // Show active filter
    const filter = (this._config.filter || '').toString().trim();
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
    // Repopulate entity picker when hass updates
    if (this.shadowRoot) {
      this._setupEntityPicker();
    }
  }

  _setupEntityPicker() {
    if (!this.shadowRoot) return;
    
    const entityPicker = this.shadowRoot.getElementById('entity-picker');
    if (!entityPicker) return;
    
    // Populate the select with filtered entities
    if (this._hass) {
      const sensorEntities = Object.keys(this._hass.states)
        .filter((id) => id.startsWith('sensor.auckland_transport') && !id.includes('_vehicle_location'))
        .sort();
      
      // Clear existing options except the first one
      entityPicker.innerHTML = '<option value="">Select an entity...</option>';
      
      // Add entity options
      sensorEntities.forEach((entityId) => {
        const option = document.createElement('option');
        option.value = entityId;
        option.textContent = entityId;
        entityPicker.appendChild(option);
      });
    }
    
    // Set initial value
    if (this._config?.entity) {
      entityPicker.value = this._config.entity;
    }
    
    // Add event listener (only once)
    if (!entityPicker._listenerAdded) {
      entityPicker.addEventListener('change', (ev) => {
        ev.stopPropagation();
        const value = ev.target.value;
        if (value) {
          this._updateConfig('entity', value);
        }
      });
      entityPicker._listenerAdded = true;
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
    
    // Show/hide arrival/departure icon pickers based on show_direction switch
    const showDirection = config.show_direction === true;
    ['arriving-icon-field', 'departing-icon-field', 'arriving-color-field', 'departing-color-field']
      .forEach((id) => {
        const el = root.getElementById(id);
        if (el) el.style.display = showDirection ? 'block' : 'none';
      });

    // Show/hide map zoom based on show_map switch
    const mapZoomField = root.getElementById('map-zoom-field');
    if (mapZoomField) {
      mapZoomField.style.display = config.show_map === true ? 'block' : 'none';
    }
    
    // Show/hide map marker type select based on show_map switch
    const mapMarkerTypeField = root.getElementById('map-marker-type-field');
    if (mapMarkerTypeField) {
      mapMarkerTypeField.style.display = config.show_map === true ? 'block' : 'none';
    }
    
    // Show/hide map marker icon based on show_map and marker type
    const mapMarkerIconField = root.getElementById('map-marker-icon-field');
    if (mapMarkerIconField) {
      const showIcon = config.show_map === true && (config.map_marker_type === 'icon' || !config.map_marker_type);
      mapMarkerIconField.style.display = showIcon ? 'block' : 'none';
    }
    
    // Show/hide map marker name based on show_map and marker type
    const mapMarkerNameField = root.getElementById('map-marker-name-field');
    if (mapMarkerNameField) {
      const showName = config.show_map === true && config.map_marker_type === 'name';
      mapMarkerNameField.style.display = showName ? 'block' : 'none';
    }
    
    // Show/hide filter indicator based on whether filter has a value
    const filterIndicatorField = root.getElementById('filter-indicator-field');
    if (filterIndicatorField) {
      const hasFilter = config.filter && config.filter.toString().trim() !== '';
      filterIndicatorField.style.display = hasFilter ? 'block' : 'none';
    }
  }

  _updateValues() {
    if (!this.shadowRoot || !this._config) return;
    
    const config = this._config;
    const root = this.shadowRoot;
    
    // Setup and update entity picker
    this._setupEntityPicker();
    
    root.querySelectorAll('ha-input[configValue]').forEach((el) => {
      const key = el.getAttribute('configValue');
      if (key === 'title') el.value = config.title || '';
      if (key === 'max_rows') el.value = config.max_rows || '';
      if (key === 'header_logo_size') el.value = config.header_logo_size || 40;
      if (key === 'header_icon_size') el.value = config.header_icon_size || 28;
      if (key === 'header_icon_color') el.value = config.header_icon_color || '';
      if (key === 'filter') el.value = config.filter || '';
      if (key === 'arriving_color') el.value = config.arriving_color || '';
      if (key === 'departing_color') el.value = config.departing_color || '';
      if (key === 'map_zoom') el.value = config.map_zoom || 14;
      if (key === 'map_marker_name') el.value = config.map_marker_name || '';
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
      if (key === 'show_direction') el.checked = config.show_direction === true;
      if (key === 'show_map') el.checked = config.show_map === true;
      if (key === 'show_footer_api_break') el.checked = config.show_footer_api_break === true;
      if (key === 'show_footer_remaining') el.checked = config.show_footer_remaining === true;
      if (key === 'show_footer_filter') el.checked = config.show_footer_filter === true;
    });

    const iconPicker = root.querySelector('ha-icon-picker[configValue="header_icon"]');
    if (iconPicker) {
      iconPicker.value = config.header_icon || '';
    }
    
    const mapMarkerIconPicker = root.querySelector('ha-icon-picker[configValue="map_marker_icon"]');
    if (mapMarkerIconPicker) {
      mapMarkerIconPicker.value = config.map_marker_icon || '';
    }

    const arrivingIconPicker = root.querySelector('ha-icon-picker[configValue="arriving_icon"]');
    if (arrivingIconPicker) {
      arrivingIconPicker.value = config.arriving_icon || 'mdi:location-enter';
    }

    const departingIconPicker = root.querySelector('ha-icon-picker[configValue="departing_icon"]');
    if (departingIconPicker) {
      departingIconPicker.value = config.departing_icon || 'mdi:location-exit';
    }

    // Update map marker type select
    const mapMarkerTypeSelect = root.getElementById('map-marker-type-select');
    if (mapMarkerTypeSelect) {
      mapMarkerTypeSelect.value = config.map_marker_type || 'icon';
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
        ha-input, ha-select, ha-icon-picker {
          width: 100%;
        }
        select {
          font-family: inherit;
          font-size: 14px;
        }
        label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        ha-switch {
          padding: 8px 0;
        }
      </style>
      <div class="card-config">
        <div class="section">
          <label>Entity (required)</label>
          <select id="entity-picker" style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);">
            <option value="">Select an entity...</option>
          </select>
          <ha-input
            label="Title (optional)"
            configValue="title"
          ></ha-input>
          <ha-input
            label="Max rows (optional)"
            type="number"
            configValue="max_rows"
          ></ha-input>
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
          <ha-input
            label="Logo size (px)"
            type="number"
            configValue="header_logo_size"
            id="logo-size-field"
          ></ha-input>
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
          <ha-input
            label="Icon size (px)"
            type="number"
            configValue="header_icon_size"
            id="icon-size-field"
          ></ha-input>
          <ha-input
            label="Icon color (optional)"
            configValue="header_icon_color"
            placeholder="e.g. var(--primary-color)"
            id="icon-color-field"
          ></ha-input>
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
          <div style="display: flex; align-items: center; gap: 8px;">
          <ha-switch configValue="show_direction" id="show-direction-switch"></ha-switch>
          <span>Show arrival/departure icon</span>
          </div>
          <ha-icon-picker
            label="Arriving icon"
            configValue="arriving_icon"
            id="arriving-icon-field"
          ></ha-icon-picker>
          <ha-icon-picker
            label="Departing icon"
            configValue="departing_icon"
            id="departing-icon-field"
          ></ha-icon-picker>
          <ha-input
            label="Arriving icon color (optional)"
            configValue="arriving_color"
            placeholder="e.g. var(--success-color) or #2e7d32"
            id="arriving-color-field"
          ></ha-input>
          <ha-input
            label="Departing icon color (optional)"
            configValue="departing_color"
            placeholder="e.g. var(--info-color) or #2196f3"
            id="departing-color-field"
          ></ha-input>
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
          <ha-input
            label="Filter (optional)"
            configValue="filter"
            placeholder="e.g. 70; 30; To Britomart"
            helper="Filter trips by route or destination. Use semicolon (;) to separate multiple values."
          >
          </ha-input>
        </div>

        <div class="section">
          <div class="section-title">Map Options</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <ha-switch configValue="show_map" id="show-map-switch"></ha-switch>
            <span>Show Vehicle Location Map</span>
          </div>
          <ha-input
            label="Map zoom level"
            type="number"
            configValue="map_zoom"
            min="1"
            max="20"
            id="map-zoom-field"
            helper="Zoom level for the map (1-20, default: 14)"
          ></ha-input>
          <div id="map-marker-type-field">
            <label>Map marker display</label>
            <select id="map-marker-type-select" style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);">
              <option value="icon">Icon</option>
              <option value="name">Name</option>
            </select>
          </div>
          <ha-icon-picker
            label="Map marker icon (optional)"
            configValue="map_marker_icon"
            id="map-marker-icon-field"
          ></ha-icon-picker>
          <ha-input
            label="Map marker name (optional)"
            configValue="map_marker_name"
            id="map-marker-name-field"
            placeholder="e.g. Bus, Train"
            helper="Custom friendly name for map marker"
          ></ha-input>
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

    // Configure entity picker with Auckland Transport sensor filtering
    // Use setTimeout to ensure the element is fully initialized
    setTimeout(() => {
      this._setupEntityPicker();
    }, 0);

    root.querySelectorAll('ha-input[configValue]').forEach((el) => {
      el.addEventListener('input', (ev) => {
        this._valueChanged(ev);
        // Update visibility when filter changes
        const configValue = el.getAttribute('configValue');
        if (configValue === 'filter') {
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
    
    const mapMarkerIconPicker = root.querySelector('ha-icon-picker[configValue="map_marker_icon"]');
    if (mapMarkerIconPicker) {
      mapMarkerIconPicker.addEventListener('value-changed', (ev) => {
        ev.target.configValue = 'map_marker_icon';
        this._valueChanged(ev);
      });
    }

    ['arriving_icon', 'departing_icon'].forEach((key) => {
      const picker = root.querySelector(`ha-icon-picker[configValue="${key}"]`);
      if (picker) {
        picker.addEventListener('value-changed', (ev) => {
          ev.target.configValue = key;
          this._valueChanged(ev);
        });
      }
    });

    const mapMarkerTypeSelect = root.getElementById('map-marker-type-select');
    if (mapMarkerTypeSelect && !mapMarkerTypeSelect._listenerAdded) {
      mapMarkerTypeSelect.addEventListener('change', (ev) => {
        ev.stopPropagation();
        const value = ev.target.value;
        this._updateConfig('map_marker_type', value);
        this._updateVisibility();
      });
      mapMarkerTypeSelect._listenerAdded = true;
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
