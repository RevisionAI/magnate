// Sign layer vocabulary (status w3-assets-a §3.2, request R3): company wordmarks resolve through the SignAtlas with the
// company's name, owner colour and emblem; `local:<icon>` boards, `civic:<kind>` inscriptions and the exchange's
// `ticker` band become text slots. One atlas per city scene; slots are cached by the atlas.
import type { SignQuad } from '../assets/AssetFactory';
import type { SignAtlas, UvRect, CompanyStyle } from '../materials/SignAtlas';
import { OWNER_COLORS, OWNER_EMBLEMS, NEUTRAL_OWNER } from '@/theme/tokens';
import type { CityCompanyStyle } from './CitySource';

const LOCAL_TEXT: Record<string, string> = {
  shoe: 'Shoes', gem: 'Jeweller', sofa: 'Furniture', toy: 'Toys', book: 'Books', flower: 'Florist', bakery: 'Bakery', coffee: 'Coffee',
};
const CIVIC_TEXT: Record<string, string> = {
  hall: 'City Hall', exchange: 'Stock Exchange', bank: 'Bank', school: 'School', hospital: 'Hospital', police: 'Police',
  fire: 'Fire Station', university: 'University', stadium: 'Stadium', parking: 'P', port: 'Port Authority',
};

export class SignResolver {
  private companies = new Map<string, CityCompanyStyle>();
  private key = '';

  constructor(private readonly atlas: SignAtlas) {}

  /** Install the company list; returns true when names or colours changed (sign meshes need a refresh). */
  setCompanies(list: readonly CityCompanyStyle[]): boolean {
    const key = [...list].sort((a, b) => a.id - b.id).map((c) => `${c.id}:${c.name}:${c.colorIndex}`).join('|');
    if (key === this.key) return false;
    this.key = key;
    this.companies = new Map(list.map((c) => [String(c.id), c]));
    return true;
  }

  styleFor(companyId: string): CompanyStyle {
    const c = this.companies.get(companyId);
    if (c) {
      const i = ((c.colorIndex % 8) + 8) % 8;
      return { id: `c${c.id}`, name: c.name, color: OWNER_COLORS[i] ?? NEUTRAL_OWNER, emblem: OWNER_EMBLEMS[i] ?? 'circle' };
    }
    const m = /^owner:(\d+)$/.exec(companyId);
    const i = m ? Number(m[1]) % 8 : 7;
    return { id: `o${i}`, name: i === 0 ? 'Your Company' : `Rival ${i}`, color: OWNER_COLORS[i] ?? NEUTRAL_OWNER, emblem: OWNER_EMBLEMS[i] ?? 'circle' };
  }

  uvFor(sign: SignQuad): UvRect {
    const id = sign.companyId ?? '';
    if (sign.style === 'closed') return this.atlas.closed();
    if (sign.style === 'text') return this.atlas.label(sign.text ?? '');
    if (id.startsWith('local:')) {
      const icon = id.slice(6);
      return this.atlas.label(LOCAL_TEXT[icon] ?? icon, '#46505A', '#F4F1E6');
    }
    if (id.startsWith('civic:')) {
      const kind = id.slice(6);
      if (kind === 'parking') return this.atlas.label('P', '#2F5DA8', '#FFFFFF');
      return this.atlas.label(CIVIC_TEXT[kind] ?? kind, '#5A6672', '#F4F1E6');
    }
    if (id === 'ticker') return this.atlas.label('MSE ▲ 1.8%   MAG ▲ 0.6%   OIL ▼ 0.4%', '#0E1216', '#F0C75E');
    return this.atlas.uvFor(sign, this.styleFor(id));
  }
}
