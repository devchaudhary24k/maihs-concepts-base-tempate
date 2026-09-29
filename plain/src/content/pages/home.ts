import type { PageContent } from '../types'

export const home: PageContent = {
  path: '/',
  title: 'Home',
  meta: {
    title: 'Bedrijfsnaam',
    description: '',
  },
  sections: [
    {
      type: 'hero',
      title: 'Welkom',
      intro: 'Deze website wordt nog gebouwd.',
      image: null,
      primaryAction: null,
    },
  ],
}
