export default async function handler(req, res) {

  /*
   * Spamhaus DQS key is read ONLY from Vercel's
   * server-side environment variables.
   *
   * Vercel:
   * SPAMHAUS_DQS_KEY
   */

  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'UNKNOWN',
      detail: 'Method not allowed',
      codes: []
    });
  }

  const key = process.env.SPAMHAUS_DQS_KEY;

  if (!key) {
    return res.status(500).json({
      status: 'KEY REQUIRED',
      detail: 'SPAMHAUS_DQS_KEY is not configured in Vercel.',
      codes: []
    });
  }

  const body =
    typeof req.body === 'string'
      ? JSON.parse(req.body)
      : (req.body || {});

  const target =
    typeof body.target === 'string'
      ? body.target.trim()
      : '';

  const type =
    body.type === 'domain'
      ? 'domain'
      : 'ip';

  if (!target) {
    return res.status(400).json({
      status: 'UNKNOWN',
      detail: 'Target is required.',
      codes: []
    });
  }

  /*
   * Basic input validation.
   */

  if (type === 'ip') {

    const ipv4Regex =
      /^(?:\d{1,3}\.){3}\d{1,3}$/;

    if (!ipv4Regex.test(target)) {

      return res.status(400).json({
        status: 'N/A',
        detail: 'This Spamhaus endpoint currently accepts IPv4 addresses.',
        codes: []
      });

    }

    const octets =
      target.split('.').map(Number);

    if (
      octets.some(
        octet =>
          octet < 0 ||
          octet > 255
      )
    ) {

      return res.status(400).json({
        status: 'N/A',
        detail: 'Invalid IPv4 address.',
        codes: []
      });

    }

  } else {

    /*
     * Domain validation.
     */

    const domainRegex =
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\.?$/;

    if (!domainRegex.test(target)) {

      return res.status(400).json({
        status: 'N/A',
        detail: 'Invalid domain name.',
        codes: []
      });

    }

  }


  /*
   * Build the Spamhaus DQS query.
   */

  let hostname;

  if (type === 'ip') {

    const reversed =
      target
        .split('.')
        .reverse()
        .join('.');

    hostname =
      `${reversed}.${key}.zen.dq.spamhaus.net`;

  } else {

    const domain =
      target.replace(/\.$/, '');

    hostname =
      `${domain}.${key}.dbl.dq.spamhaus.net`;

  }


  /*
   * Resolve the DQS hostname.
   *
   * DNS-over-HTTPS is performed server-side so the
   * browser never sees the DQS key.
   */

  const dohUrl =
    'https://dns.google/resolve?name=' +
    encodeURIComponent(hostname) +
    '&type=A';


  try {

    const response =
      await fetch(
        dohUrl,
        {
          headers: {
            'Accept': 'application/dns-json'
          }
        }
      );

    if (!response.ok) {

      return res.status(502).json({
        status: 'UNKNOWN',
        detail:
          'DNS-over-HTTPS returned HTTP ' +
          response.status,
        codes: []
      });

    }

    const dns =
      await response.json();


    /*
     * No answer / NXDOMAIN means the target
     * was not returned by the queried DQS list.
     */

    if (
      dns.Status === 3 ||
      !dns.Answer ||
      dns.Answer.length === 0
    ) {

      return res.status(200).json({
        status: 'CLEAR',
        detail: 'NXDOMAIN / not listed',
        codes: []
      });

    }


    /*
     * Extract only IPv4 response codes.
     */

    const codes =
      [
        ...new Set(
          (dns.Answer || [])
            .filter(
              answer =>
                answer.type === 1 &&
                typeof answer.data === 'string'
            )
            .map(
              answer =>
                answer.data.trim()
            )
            .filter(
              ip =>
                /^127\./.test(ip)
            )
        )
      ];


    if (codes.length > 0) {

      return res.status(200).json({
        status: 'LISTED',
        detail:
          'Spamhaus returned one or more blacklist codes.',
        codes
      });

    }


    /*
     * DNS response existed but didn't contain a
     * recognised 127.x.x.x listing code.
     */

    if (dns.Status === 5) {

      return res.status(200).json({
        status: 'UNKNOWN',
        detail:
          'DNS query refused by the Spamhaus DQS service.',
        codes: []
      });

    }


    return res.status(200).json({
      status: 'CLEAR',
      detail: 'No Spamhaus blacklist answer',
      codes: []
    });


  } catch (error) {

    return res.status(502).json({
      status: 'UNKNOWN',
      detail:
        'Spamhaus lookup failed: ' +
        (error?.message || 'Unknown error'),
      codes: []
    });

  }

}
