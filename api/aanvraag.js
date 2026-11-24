// Vercel Function: POST /api/aanvraag
// Ontvangt een aanvraag uit de configurator, rekent de samenstelling opnieuw door en mailt die
// naar Airtrailer. De logica staat in configurator/request.js; hier worden alleen de catalogus
// en de mailserver aangesloten.

import { catalog } from '../configurator/catalog.js';
import { createMailer } from '../configurator/mailer.js';
import { createRequestHandler } from '../configurator/request.js';

const handle = createRequestHandler({ catalog, mailer: createMailer(process.env) });

export default {
  fetch(request) {
    return handle(request);
  },
};
