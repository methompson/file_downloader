import LuxonAdapter from '@date-io/luxon';
import '@mdi/font/css/materialdesignicons.css';

import 'vuetify/lib/styles/main.sass';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export function getVuetify() {
  const vuetify = createVuetify({
    components,
    directives,
    icons: {
      defaultSet: 'mdi',
    },
    date: {
      adapter: LuxonAdapter,
    },
  });

  return vuetify;
}
