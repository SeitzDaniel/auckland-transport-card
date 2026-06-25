# Auckland Transport Card


> Custom card for [Auckland Transport Integration](https://github.com/SeitzDaniel/auckland_transport) Lovelace UI


Please note this card will only work with the Auckland Transport Integration!

<img width="812" height="357" alt="Screenshot 2025-11-05 110345" src="https://github.com/user-attachments/assets/dfe8910f-7fea-42c3-a5fe-c0b29b5c713c" />


## Installation
### HACS (recommended)

1. [Install HACS](https://hacs.xyz/docs/use/download/download/), if you did not already
2. [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=SeitzDaniel&repository=auckland-transport-card&category=plugin)
3. Install the Auckland Transport Card
4. Restart Home Assistant.

### Manual

1. Download `auckland-transport-card.js` file from the [latest-release].
2. Put `auckland-transport-card.js` file into your `config/www` folder.
3. Add reference to `auckland-transport-card.js` in Lovelace. There's two way to do that:

   1. **Using UI:** _Configuration_ → _Lovelace Dashboards_ → _Resources Tab_ → Click Plus button → Set _Url_ as `/local/auckland-transport-card.js` → Set _Resource type_ as `JavaScript Module`.
      **Note:** If you do not see the Resources Tab, you will need to enable _Advanced Mode_ in your _User Profile_
   2. **Using YAML:** Add following code to `lovelace` section.

      ```yaml
      resources:
        - url: /local/auckland-transport-card.js
          type: module
      ```

4. Add `custom:auckland-transport-card` to Lovelace UI as any other card (using either editor or YAML configuration).

## Usage

All options for this card can be configured via the Lovelace UI editor.

<img width="511" height="1325" alt="Screenshot 2025-11-05 110517" src="https://github.com/user-attachments/assets/0ae5186b-779a-44cf-be3f-fa1b04c7318e" />

### Arrival / departure icon

Enable **Show arrival/departure icon** (`show_direction: true`) to add a per-row icon that
indicates whether a service is **arriving** at the stop (terminating here) or **departing**
(originating or continuing onward). The arriving/departing icons are configurable
(`arriving_icon`, `departing_icon`).

The direction is determined from the GTFS `pickup_type` field exposed by the integration
(`pickup_type == 1` ⇒ arriving). If your installed integration version does not yet expose
that attribute, the card falls back to a headsign-vs-stop-name heuristic, which works well at
terminus stations. The GTFS-correct path everywhere depends on the integration exposing
`pickup_type` (see [auckland_transport#7](https://github.com/SeitzDaniel/auckland_transport/pull/7)).

## License

MIT © [Daniel Seitz](https://github.com/SeitzDaniel)
