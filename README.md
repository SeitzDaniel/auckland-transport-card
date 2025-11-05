# Auckland Transport Card


> Custom card for [Auckland Transport Integration](https://github.com/SeitzDaniel/auckland_transport) Lovelace UI


Please note this card will only work with the Auckland Transport Integration!

<img width="812" height="357" alt="Screenshot 2025-11-05 110345" src="https://github.com/user-attachments/assets/dfe8910f-7fea-42c3-a5fe-c0b29b5c713c" />


## Installation
### HACS (recommended)

1. [Install HACS](https://hacs.xyz/docs/use/download/download/), if you did not already
2. [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=SeitzDaniel&repository=auckland-transport-card&category=lovelace)
3. Install the Auckland Transport integration
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

## License

MIT © [Daniel Seitz](https://github.com/SeitzDaniel)
