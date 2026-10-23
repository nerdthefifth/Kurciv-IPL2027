import type { PitchProfile, Venue, CountryCode } from '@kurciv/domain';

export const pitchProfile = (kind: PitchProfile['kind']): PitchProfile => {
  switch (kind) {
    case 'flat':
      return { kind, pace: -0.2, spin: -0.2, bounce: 0.1, batting: 0.6, wear: 0.1 };
    case 'green':
      return { kind, pace: 0.6, spin: -0.4, bounce: 0.4, batting: -0.2, wear: 0.1 };
    case 'dry':
      return { kind, pace: -0.2, spin: 0.6, bounce: -0.1, batting: -0.1, wear: 0.45 };
    case 'slow':
      return { kind, pace: 0.1, spin: 0.3, bounce: -0.4, batting: -0.35, wear: 0.3 };
    case 'balanced':
      return { kind, pace: 0.1, spin: 0.1, bounce: 0.1, batting: 0.15, wear: 0.2 };
  }
};

const v = (
  id: string, name: string, city: string, country: CountryCode, straight: number, square: number, kind: PitchProfile['kind'], dew: number, altitude = 10,
): Venue => ({ id, name, city, country, boundaryStraight: straight, boundarySquare: square, altitude, pitch: pitchProfile(kind), dewChance: dew });

/** Boundary measurements are approximate playing dimensions (metres from pitch centre). */
export const VENUES: Venue[] = [
  v('wankhede', 'Wankhede Stadium', 'Mumbai', 'IND', 72, 66, 'flat', 0.6),
  v('chepauk', 'MA Chidambaram Stadium', 'Chennai', 'IND', 74, 70, 'dry', 0.35),
  v('chinnaswamy', 'M. Chinnaswamy Stadium', 'Bengaluru', 'IND', 68, 62, 'flat', 0.3, 920),
  v('eden', 'Eden Gardens', 'Kolkata', 'IND', 73, 67, 'balanced', 0.5),
  v('kotla', 'Arun Jaitley Stadium', 'Delhi', 'IND', 69, 64, 'slow', 0.35),
  v('uppal', 'Rajiv Gandhi Intl. Stadium', 'Hyderabad', 'IND', 74, 68, 'flat', 0.3, 540),
  v('sms', 'Sawai Mansingh Stadium', 'Jaipur', 'IND', 75, 69, 'balanced', 0.3, 430),
  v('mullanpur', 'Maharaja Yadavindra Singh Stadium', 'Mullanpur', 'IND', 76, 70, 'green', 0.35, 330),
  v('motera', 'Narendra Modi Stadium', 'Ahmedabad', 'IND', 78, 72, 'balanced', 0.4),
  v('ekana', 'Ekana Stadium', 'Lucknow', 'IND', 76, 71, 'slow', 0.4),
  v('scg', 'Sydney Cricket Ground', 'Sydney', 'AUS', 75, 69, 'balanced', 0.15),
  v('showground', 'Sydney Showground Stadium', 'Sydney', 'AUS', 74, 68, 'flat', 0.1),
  v('mcg', 'Melbourne Cricket Ground', 'Melbourne', 'AUS', 82, 76, 'balanced', 0.1),
  v('docklands', 'Docklands Stadium', 'Melbourne', 'AUS', 76, 70, 'flat', 0.05),
  v('perth', 'Perth Stadium', 'Perth', 'AUS', 80, 74, 'green', 0.05),
  v('adelaide', 'Adelaide Oval', 'Adelaide', 'AUS', 77, 64, 'flat', 0.1),
  v('gabba', 'The Gabba', 'Brisbane', 'AUS', 76, 72, 'green', 0.2),
  v('bellerive', 'Bellerive Oval', 'Hobart', 'AUS', 72, 67, 'green', 0.05),
  v('lords', "Lord's", 'London', 'ENG', 72, 66, 'balanced', 0.05),
  v('oval', 'The Oval', 'London', 'ENG', 72, 68, 'flat', 0.05),
  v('oldtrafford', 'Old Trafford', 'Manchester', 'ENG', 74, 68, 'green', 0.05),
  v('edgbaston', 'Edgbaston', 'Birmingham', 'ENG', 71, 66, 'flat', 0.05),
  v('headingley', 'Headingley', 'Leeds', 'ENG', 70, 66, 'green', 0.05),
  v('trentbridge', 'Trent Bridge', 'Nottingham', 'ENG', 70, 64, 'flat', 0.05),
  v('rosebowl', 'The Rose Bowl', 'Southampton', 'ENG', 74, 69, 'balanced', 0.05),
  v('sophia', 'Sophia Gardens', 'Cardiff', 'ENG', 70, 64, 'slow', 0.05),
  v('wanderers', 'The Wanderers', 'Johannesburg', 'SA', 70, 66, 'flat', 0.1, 1750),
  v('newlands', 'Newlands', 'Cape Town', 'SA', 74, 68, 'balanced', 0.05),
  v('kingsmead', 'Kingsmead', 'Durban', 'SA', 72, 67, 'green', 0.3),
  v('centurion', 'SuperSport Park', 'Centurion', 'SA', 72, 66, 'flat', 0.1, 1400),
  v('stgeorges', "St George's Park", 'Gqeberha', 'SA', 74, 69, 'slow', 0.1),
  v('boland', 'Boland Park', 'Paarl', 'SA', 70, 65, 'dry', 0.05),
  v('gaddafi', 'Gaddafi Stadium', 'Lahore', 'PAK', 75, 70, 'flat', 0.45),
  v('nationalkhi', 'National Stadium', 'Karachi', 'PAK', 76, 70, 'slow', 0.35),
  v('pindi', 'Rawalpindi Cricket Stadium', 'Rawalpindi', 'PAK', 72, 66, 'flat', 0.3),
  v('arbab', 'Arbab Niaz Stadium', 'Peshawar', 'PAK', 72, 67, 'green', 0.2),
  v('bugti', 'Bugti Stadium', 'Quetta', 'PAK', 73, 68, 'balanced', 0.1, 1680),
  v('multan', 'Multan Cricket Stadium', 'Multan', 'PAK', 75, 70, 'dry', 0.3),
  v('dubai', 'Dubai International Stadium', 'Dubai', 'UAE', 77, 71, 'slow', 0.55),
  v('zayed', 'Zayed Cricket Stadium', 'Abu Dhabi', 'UAE', 78, 72, 'balanced', 0.5),
  v('sharjah', 'Sharjah Cricket Stadium', 'Sharjah', 'UAE', 68, 62, 'dry', 0.5),
  v('qpo', "Queen's Park Oval", 'Port of Spain', 'WI', 74, 68, 'slow', 0.15),
  v('sabina', 'Sabina Park', 'Kingston', 'WI', 72, 67, 'flat', 0.1),
  v('kensington', 'Kensington Oval', 'Bridgetown', 'WI', 73, 68, 'balanced', 0.1),
  v('providence', 'Providence Stadium', 'Providence', 'WI', 75, 70, 'dry', 0.15),
  v('sammy', 'Daren Sammy Stadium', 'Gros Islet', 'WI', 71, 66, 'flat', 0.1),
  v('vivian', 'Sir Vivian Richards Stadium', "St John's", 'WI', 74, 69, 'slow', 0.1),
  v('nassau', 'Nassau County Stadium', 'New York', 'USA', 73, 68, 'green', 0.05),
  v('grandprairie', 'Grand Prairie Stadium', 'Grand Prairie', 'USA', 72, 67, 'flat', 0.05),
  v('oakland', 'Bay Area Cricket Ground', 'Oakland', 'USA', 71, 66, 'balanced', 0.05),
  v('churchst', 'Church Street Park', 'Morrisville', 'USA', 70, 65, 'flat', 0.1),
  v('edenpark', 'Eden Park', 'Auckland', 'NZ', 66, 62, 'flat', 0.05),
  v('skystadium', 'Sky Stadium', 'Wellington', 'NZ', 70, 66, 'balanced', 0.05),
  v('hagley', 'Hagley Oval', 'Christchurch', 'NZ', 71, 66, 'green', 0.05),
  v('seddon', 'Seddon Park', 'Hamilton', 'NZ', 68, 63, 'flat', 0.05),
  v('university', 'University Oval', 'Dunedin', 'NZ', 70, 65, 'green', 0.05),
  v('mclean', 'McLean Park', 'Napier', 'NZ', 69, 64, 'flat', 0.05),
  v('premadasa', 'R. Premadasa Stadium', 'Colombo', 'SL', 74, 69, 'slow', 0.4),
  v('pallekele', 'Pallekele Stadium', 'Kandy', 'SL', 73, 68, 'balanced', 0.3),
  v('galle', 'Galle International Stadium', 'Galle', 'SL', 71, 66, 'dry', 0.2),
  v('dambulla', 'Rangiri Dambulla Stadium', 'Dambulla', 'SL', 73, 68, 'dry', 0.3),
  v('mirpur', 'Shere Bangla National Stadium', 'Dhaka', 'BAN', 72, 67, 'slow', 0.45),
  v('zahur', 'Zahur Ahmed Chowdhury Stadium', 'Chattogram', 'BAN', 72, 67, 'balanced', 0.35),
  v('sylhet', 'Sylhet International Stadium', 'Sylhet', 'BAN', 71, 66, 'green', 0.3),
];
