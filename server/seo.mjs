const origin = 'https://www.breezyeevans.co.uk';
export const pages = {
  index: ['Self-drive Van Hire | Breezyee Vans', 'Explore Breezyee Vans: Citroen Berlingo, Mercedes Sprinter and Iveco Daily Luton van hire. Compare rates and request your preferred dates.'],
  fleet: ['Our Vans & Daily Hire Rates | Breezyee Vans', 'Compare our small, medium and XL vans, load space and daily hire rates. Find the right Breezyee van for your next move.'],
  vehicle: ['Vehicle Preview & Booking | Breezyee Vans', 'View a Breezyee van preview, compare load space and daily rates, then continue to a booking request for your chosen vehicle.'],
  booking: ['Request a Van Booking | Breezyee Vans', 'Choose your van, review your estimated hire price and securely submit your booking request. Availability is confirmed by our team.'],
  services: ['Van Hire & Moving Enquiries | Breezyee Vans', 'Explore self-drive van hire for collections, larger moves and business transport. Discuss your moving requirements with Breezyee Vans.'],
  contact: ['Contact Breezyee Vans | Van Hire Enquiries', 'Call Breezyee Vans on +44 7300 331603 or send an enquiry about van hire, a move or an existing booking request.'],
  terms: ['Vehicle Hire Terms | Breezyee Vans', 'Read the Breezyee Vans hire terms, driver requirements and responsibilities before requesting a vehicle.'],
  privacy: ['Privacy Notice | Breezyee Vans', 'How Breezyee Vans uses enquiry, booking, account and driver verification information, and how to contact us about your data.'],
  cookies: ['Cookies & Browser Storage | Breezyee Vans', 'Learn about account storage, form retry protection and Google reCAPTCHA on the Breezyee Vans website.'],
};
export function seoPlugin() {
  return {
    name:'breezyee-static-seo',
    transformIndexHtml(html,context) {
      const name=context.filename.split(/[\\/]/).pop().replace('.html','');
      const existing=html.match(/<title>(.*?)<\/title>/)?.[1] || 'Breezyee Vans';
      const [title,description]=pages[name] || [existing,`${existing}. Secure account access for Breezyee Vans customers and staff.`];
      const url=origin+(name==='index'?'/':`/${name}`);
      html=html.replace(/<title>.*?<\/title>/,`<title>${title}</title>`);
      const tags=[{tag:'meta',attrs:{name:'description',content:description}},{tag:'meta',attrs:{name:'robots',content:pages[name]?'index,follow':'noindex,nofollow'}},{tag:'link',attrs:{rel:'canonical',href:url}},{tag:'link',attrs:{rel:'icon',href:'/logo.png',type:'image/png'}},
        ...Object.entries({'og:title':title,'og:description':description,'og:url':url,'og:type':'website','og:site_name':'Breezyee Vans','og:locale':'en_GB','og:image':`${origin}/van-medium.jpg`}).map(([property,content])=>({tag:'meta',attrs:{property,content}})),
        ...Object.entries({'twitter:card':'summary_large_image','twitter:title':title,'twitter:description':description,'twitter:image':`${origin}/van-medium.jpg`}).map(([name,content])=>({tag:'meta',attrs:{name,content}}))];
      if(name==='index') tags.push({tag:'script',attrs:{type:'application/ld+json'},children:JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:'Breezyee Vans',url:origin,logo:`${origin}/logo.png`,telephone:'+447300331603',email:'info@breezyeevans.co.uk'})});
      if(process.env.GOOGLE_SITE_VERIFICATION) tags.push({tag:'meta',attrs:{name:'google-site-verification',content:process.env.GOOGLE_SITE_VERIFICATION}});
      return {html,tags};
    },
    generateBundle() {
      this.emitFile({type:'asset',fileName:'sitemap.xml',source:`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(pages).map(name=>`<url><loc>${origin}${name==='index'?'/':'/'+name}</loc></url>`).join('')}</urlset>`});
      this.emitFile({type:'asset',fileName:'robots.txt',source:`User-agent: *\nDisallow: /api/\nDisallow: /admin-\nDisallow: /dashboard\nDisallow: /user-dashboard\nDisallow: /login\nDisallow: /reset-password\nSitemap: ${origin}/sitemap.xml\n`});
    },
  };
}
