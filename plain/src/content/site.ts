import type { SiteContent } from './types'

export const site: SiteContent = {
  name: 'Bedrijfsnaam',
  url: 'https://www.example.nl',
  tagline: '',
  contact: {
    phone: '',
    email: '',
    address: '',
    postcode: '',
    city: '',
  },
  navigation: [{ label: 'Home', href: '/' }],
  footerNavigation: [],
}
