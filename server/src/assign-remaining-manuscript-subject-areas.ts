import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const applyChanges = process.argv.includes("--apply");

type SubjectArea = {
  id: bigint;
  majorSubject: string;
  classificationName: string;
  subjectArea: string;
};
type Manuscript = {
  id: bigint;
  title: string;
  keywords: string;
  journalTitle: string;
};
type Rule = { subjectArea: string; patterns: RegExp[] };

const rules: Rule[] = [
  { subjectArea: "Ophthalmology", patterns: [/ophthalm|glaucoma|retina|ocular|cataract/] },
  { subjectArea: "Neurology (clinical)", patterns: [/epilep|seizure|clinical neurolog|stroke patient|parkinson|alzheimer/] },
  { subjectArea: "Cancer Research", patterns: [/cancer|oncolog|tumor|tumour|carcinoma|leukemia|melanoma/] },
  { subjectArea: "Infectious Diseases", patterns: [/infectious disease|antimicrobial resistance|antibiotic resistance|pathogen resistance/] },
  { subjectArea: "Epidemiology", patterns: [/epidemiolog|disease surveillance|disease prevalence/] },
  { subjectArea: "Public Health, Environmental and Occupational Health", patterns: [/public health|occupational health|community medicine|healthcare policy|health policy|universal health coverage/] },
  { subjectArea: "Health Informatics", patterns: [/health informatics|medical informatics|digital health|telemedicine|healthcare information system|medical question answering/] },
  { subjectArea: "Pharmaceutical Science", patterns: [/pharmaceutical|pharmacy|drug formulation|drug delivery|regulatory affairs|pharmacovigilance/] },
  { subjectArea: "Pharmacology", patterns: [/pharmacology|pharmacokinetic|pharmacodynamic/] },
  { subjectArea: "Drug Discovery", patterns: [/drug discovery|novel drug|molecular docking|drug design/] },
  { subjectArea: "Cardiology and Cardiovascular Medicine", patterns: [/cardio|heart disease|hypertension|blood pressure/] },
  { subjectArea: "Psychiatry and Mental Health", patterns: [/psychiatr|mental health|depression|anxiety disorder|schizophren/] },
  { subjectArea: "General Nursing", patterns: [/\bnursing\b|nurse practice|nursing care/] },
  { subjectArea: "Physical Therapy, Sports Therapy and Rehabilitation", patterns: [/physiotherap|physical therapy|rehabilitation therap/] },
  { subjectArea: "Anesthesiology and Pain Medicine", patterns: [/anaesthe|anesthe|pain medicine/] },
  { subjectArea: "Pediatrics, Perinatology and Child Health", patterns: [/pediatr|paediatr|child health|neonatal/] },
  { subjectArea: "Obstetrics and Gynecology", patterns: [/obstetric|gynecol|maternal health|pregnancy|pregnant women/] },
  { subjectArea: "General Dentistry", patterns: [/dentistry|dental|oral health/] },
  { subjectArea: "Radiology, Nuclear Medicine and Imaging", patterns: [/radiology|medical imaging|radiograph|computed tomography|magnetic resonance imaging/] },
  { subjectArea: "Dermatology", patterns: [/dermatolog|skin disease/] },
  { subjectArea: "Orthopedics and Sports Medicine", patterns: [/orthop|musculoskeletal|sports medicine/] },
  { subjectArea: "General Medicine", patterns: [/general medicine|clinical medicine|medical science|medical case report/] },
  { subjectArea: "Medical Laboratory Technology", patterns: [/medical laboratory|clinical laboratory|laboratory science/] },
  { subjectArea: "Ayurveda, Siddha, Yoga, Naturopathy, Unani, Sowa-Rigpa and Homoeopathy", patterns: [/ayurved|siddha medicine|naturopath|homeopath|homoeopath|\bayush\b|traditional medicine/] },
  { subjectArea: "Microbiology (medical)", patterns: [/clinical microbiology|medical microbiology/] },
  { subjectArea: "Molecular Medicine", patterns: [/molecular medicine|precision medicine|translational medicine/] },
  { subjectArea: "Biotechnology", patterns: [/biotechnolog|genetic engineering/] },
  { subjectArea: "Molecular Biology", patterns: [/molecular biology|gene expression|dna sequencing|rna sequencing/] },
  { subjectArea: "Genetics", patterns: [/genetic|genomic|hereditary/] },
  { subjectArea: "Microbiology", patterns: [/microbiolog|bacterial|microbial/] },
  { subjectArea: "Virology", patterns: [/virolog|viral infection|virus disease/] },
  { subjectArea: "Immunology", patterns: [/immunolog|immune response|antibody/] },
  { subjectArea: "Biochemistry", patterns: [/biochem|enzyme activity|protein chemistry/] },
  { subjectArea: "Cell Biology", patterns: [/cell biology|cellular mechanism|stem cell/] },
  { subjectArea: "Neuroscience (miscellaneous)", patterns: [/neuroscience|brain science|neural signal/] },
  { subjectArea: "Cognitive Neuroscience", patterns: [/cognitive neuroscience|brain cognition/] },
  { subjectArea: "Soil Science", patterns: [/soil science|soil health|soil fertility|pedosphere/] },
  { subjectArea: "Agricultural Engineering", patterns: [/agricultural engineering|smart farming|precision agriculture|smart irrigation|farm machinery/] },
  { subjectArea: "Agronomy and Crop Science", patterns: [/agronom|crop science|crop yield|crop stress|millet|paddy|\brice\b|\bwheat\b/] },
  { subjectArea: "Plant Science", patterns: [/plant science|plant disease|plant growth|botanical|phytochem|tomato plant/] },
  { subjectArea: "Horticulture", patterns: [/horticultur|floricultur|fruit crop|vegetable crop/] },
  { subjectArea: "Forestry", patterns: [/forestry|forest management|forest ecology/] },
  { subjectArea: "Insect Science", patterns: [/insect|entomolog|coleoptera|coccinellidae/] },
  { subjectArea: "Animal Science and Zoology", patterns: [/animal science|zoolog|livestock|avian science|poultry/] },
  { subjectArea: "Aquatic Science", patterns: [/aquatic science|fisheries|aquaculture|marine biology/] },
  { subjectArea: "Food Science", patterns: [/food science|food technolog|food processing|food safety/] },
  { subjectArea: "Ecology, Evolution, Behavior and Systematics", patterns: [/biodiversity|systematics|taxonomy|evolutionary biology/] },

  { subjectArea: "Artificial Intelligence", patterns: [/artificial intelligence|generative ai|large language model|intelligent system|expert system/] },
  { subjectArea: "Machine Learning", patterns: [/machine learning|deep learning|neural network|reinforcement learning|supervised learning|unsupervised learning/] },
  { subjectArea: "Information Technology and Cyber Security", patterns: [/cyber ?security|information security|network security|intrusion detection|malware|botnet|ddos|cryptograph/] },
  { subjectArea: "Cloud Computing and IOT", patterns: [/cloud computing|cloud infrastructure|internet of things|\biot\b|edge computing/] },
  { subjectArea: "Data Mining", patterns: [/data mining|data science|big data|predictive analytics|business analytics|data analytics/] },
  { subjectArea: "Computer Vision and Pattern Recognition", patterns: [/computer vision|image processing|pattern recognition|object detection|image classification/] },
  { subjectArea: "Computer Networks and Communications", patterns: [/computer network|data network|wireless network|network communication|communication network/] },
  { subjectArea: "Signal Processing", patterns: [/signal processing|speech processing|audio processing|digital signal/] },
  { subjectArea: "Software Engineering", patterns: [/software engineering|software testing|software quality|software architecture/] },
  { subjectArea: "Software Development", patterns: [/software development|web application|mobile application development|application software/] },
  { subjectArea: "Information Systems", patterns: [/information system|database system|database management|information management/] },
  { subjectArea: "Human-Computer Interaction", patterns: [/human computer interaction|user experience|user interface|\bhci\b|human centered computing/] },
  { subjectArea: "Hardware and Architecture", patterns: [/computer hardware|computer architecture|semiconductor|\bvlsi\b|system on chip|microprocessor/] },
  { subjectArea: "Robotics", patterns: [/robotic|autonomous robot|humanoid/] },
  { subjectArea: "General Computer Science", patterns: [/general computer science|computer science and engineering|journal of computer science\b/] },

  { subjectArea: "Civil and Structural Engineering", patterns: [/civil engineering|structural engineering|seismic|earthquake engineering|reinforced concrete|steel structure|shear wall|bridge engineering|high rise building/] },
  { subjectArea: "Building and Construction", patterns: [/building construction|construction engineering|construction management|construction industr|building material/] },
  { subjectArea: "Geotechnical Engineering and Engineering Geology", patterns: [/geotechnical|foundation engineering|slope stability|rock mechanics/] },
  { subjectArea: "Architecture", patterns: [/\barchitecture\b|architectural design|interior design|spatial design/] },
  { subjectArea: "Mechanical Engineering", patterns: [/mechanical engineering|machine design|thermodynamic|heat transfer|fluid mechanic/] },
  { subjectArea: "Manufacturing Engineering", patterns: [/manufacturing engineering|manufacturing technolog|computer aided manufacturing|additive manufacturing|3d printing/] },
  { subjectArea: "Industrial Engineering", patterns: [/industrial engineering|lean manufacturing|production engineering|industrial technolog/] },
  { subjectArea: "Automotive Engineering", patterns: [/automotive|automobile|electric vehicle|vehicle engineering/] },
  { subjectArea: "Aerospace Engineering", patterns: [/aerospace|aeronautic|aviation technolog|aircraft design/] },
  { subjectArea: "Electrical Engineering", patterns: [/electrical engineering|power system|electrical machine|power electronic|electric drive/] },
  { subjectArea: "Electronics Engineering", patterns: [/electronics engineering|electronic circuit|microelectronic|nanoelectronic|instrumentation engineering/] },
  { subjectArea: "Tele Communication Engineering", patterns: [/telecommunication|wireless communication|mobile communication|optical communication/] },
  { subjectArea: "Control and Systems Engineering", patterns: [/control system|systems engineering|automation and control|process control/] },
  { subjectArea: "Ocean Engineering", patterns: [/ocean engineering|naval architecture|offshore engineering/] },
  { subjectArea: "Textile Technology", patterns: [/textile technolog|textile engineering|fabric engineering/] },
  { subjectArea: "Biomedical Engineering", patterns: [/biomedical engineering|medical device|prosthetic|artificial organ/] },
  { subjectArea: "Bioengineering", patterns: [/bioengineering|bionic engineering/] },
  { subjectArea: "Polymers and Plastics", patterns: [/polymer|plastic technolog|polymeric/] },
  { subjectArea: "Ceramics and Composites", patterns: [/ceramic|composite material|fiber reinforced polymer/] },
  { subjectArea: "Metals and Alloys", patterns: [/metal alloy|alloy development|metallic material/] },
  { subjectArea: "General Materials Science", patterns: [/materials science|material science|advanced material|smart material/] },
  { subjectArea: "Chemical Engineering (miscellaneous)", patterns: [/chemical engineering|process engineering|petrochemical engineering/] },
  { subjectArea: "Nanotechnology", patterns: [/nanotechnolog|nanomaterial|nanoparticle|nanotherapeutic/] },
  { subjectArea: "General Engineering and Technology", patterns: [/general engineering|engineering and technology|advanced research in engineering/] },

  { subjectArea: "Renewable Energy, Sustainability and the Environment", patterns: [/renewable energy|green energy|solar energy|wind energy|sustainable energy|carbon neutral|bioenergy|biomass energy/] },
  { subjectArea: "Energy Engineering and Power Technology", patterns: [/energy engineering|power technolog|power generation|energy system/] },
  { subjectArea: "Petroleum Engineering", patterns: [/petroleum|oil and gas|reservoir engineering/] },
  { subjectArea: "Water Resource Engineering", patterns: [/water resource|hydrolog|river basin|irrigation engineering/] },
  { subjectArea: "Waste Management and Disposal", patterns: [/waste management|waste disposal|e waste|electronic waste|solid waste/] },
  { subjectArea: "Pollution", patterns: [/air pollution|water pollution|soil pollution|pollution control/] },
  { subjectArea: "Environmental Engineering", patterns: [/environmental engineering|environmental technolog|wastewater treatment/] },
  { subjectArea: "Global and Planetary Change", patterns: [/climate change|global warming|climate adaptation|climate resilience/] },
  { subjectArea: "Management, Monitoring, Policy and Law", patterns: [/environmental management|environmental policy|environmental law|environmental compliance/] },
  { subjectArea: "Nature and Landscape Conservation", patterns: [/nature conservation|wildlife conservation|landscape conservation|biodiversity conservation/] },

  { subjectArea: "Marketing Management", patterns: [/marketing management|digital marketing|consumer behavio|purchase intention|brand management|advertising|market dynamics/] },
  { subjectArea: "Human Resource Management", patterns: [/human resource|talent management|employee engagement|workforce planning|personnel management/] },
  { subjectArea: "Organizational Behavior and Human Resource Management", patterns: [/organizational behavio|organisational behavio|workplace behavio|employee behavio/] },
  { subjectArea: "Leadership and Management", patterns: [/leadership|managerial leadership/] },
  { subjectArea: "Strategy and Management", patterns: [/strategic management|business strategy|competitive strategy|corporate strategy/] },
  { subjectArea: "Management of Technology and Innovation", patterns: [/innovation management|technology management|digital transformation|technological innovation/] },
  { subjectArea: "Management Information Systems", patterns: [/management information system|business information system|enterprise system/] },
  { subjectArea: "General Business, Management and Accounting", patterns: [/journal of management\b|management research|business management|commerce and management|management science/] },
  { subjectArea: "Accounting", patterns: [/accounting|auditing|financial reporting|cost accounting/] },
  { subjectArea: "Finance", patterns: [/\bfinance\b|financial management|fintech|financial market|corporate finance/] },
  { subjectArea: "Banking and Insurance Management", patterns: [/banking|insurance management|insurance sector/] },
  { subjectArea: "Investment Portfolio Management", patterns: [/investment|portfolio management|stock market/] },
  { subjectArea: "Economics and Econometrics", patterns: [/economics|econometric|economic analysis|economic development/] },
  { subjectArea: "Business and International Management", patterns: [/international business|global business|international trade|multinational/] },
  { subjectArea: "E-Commerce and M- Commerce", patterns: [/e commerce|electronic commerce|m commerce|digital commerce/] },
  { subjectArea: "Tourism, Leisure and Hospitality Management", patterns: [/tourism|hospitality|travel management|leisure management/] },
  { subjectArea: "CRM and Service Management", patterns: [/customer relationship|customer experience|service management|service marketing/] },
  { subjectArea: "Management Science and Operations Research", patterns: [/operations research|operational research|supply chain optimization|decision optimization/] },

  { subjectArea: "Library and Information Sciences", patterns: [/library|bibliometric|scientometric|scholarly communication|citation database|information retrieval|knowledge organisation|knowledge organization/] },
  { subjectArea: "Education", patterns: [/education|teaching|learning development|pedagog|curriculum|academic performance|higher education/] },
  { subjectArea: "Law", patterns: [/\blaw\b|legal studies|legal system|jurisprudence|intellectual property rights|human rights/] },
  { subjectArea: "Political Science and International Relations", patterns: [/political science|international relations|foreign policy|world politics|diplomatic|geopolitic|electoral/] },
  { subjectArea: "Public Administration", patterns: [/public administration|public governance|government administration/] },
  { subjectArea: "Sociology and Political Science", patterns: [/sociolog|social structure|social institution/] },
  { subjectArea: "Communication", patterns: [/communication studies|mass communication|media studies|disaster communication|social media and society/] },
  { subjectArea: "Linguistics and Language", patterns: [/linguistic|language teaching|english language|natural language studies/] },
  { subjectArea: "Literature and Literary Theory", patterns: [/literature|literary|fiction|poetry|novel|postcolonial/] },
  { subjectArea: "Gender Studies", patterns: [/gender studies|feminis|women empowerment|gender discrimination/] },
  { subjectArea: "Fashion Design", patterns: [/fashion design|apparel|fashion technolog|smart textile/] },
  { subjectArea: "Visual Arts and Performing Arts", patterns: [/fine art|visual art|performing art|painting|theatre|theater/] },
  { subjectArea: "Museology", patterns: [/museum|museology|cultural heritage preservation/] },
  { subjectArea: "History", patterns: [/history research|historical studies|historical analysis/] },
  { subjectArea: "Archaeology", patterns: [/archaeolog/] },
  { subjectArea: "Religious Studies", patterns: [/religious studies|religion and society|theology/] },
  { subjectArea: "Philosophy", patterns: [/philosoph|ethics theory/] },
  { subjectArea: "Social Psychology", patterns: [/social psychology|social cognition|group behavio/] },
  { subjectArea: "Applied Psychology", patterns: [/applied psychology|consumer psychology|industrial psychology/] },
  { subjectArea: "Experimental and Cognitive Psychology", patterns: [/cognitive psychology|experimental psychology|cognition/] },
  { subjectArea: "Geography, Planning and Development", patterns: [/regional planning|geography|rural development|spatial planning/] },
  { subjectArea: "Urban Studies", patterns: [/urban studies|urban development|smart cit|urban planning/] },
  { subjectArea: "Development", patterns: [/socio economic development|community development|development studies|refugee|poverty alleviation/] },
  { subjectArea: "Transportation", patterns: [/transportation|traffic engineering|railway|public transport|transport system/] },
  { subjectArea: "Sports Science", patterns: [/sports science|physical education|athletic performance|football player|sports training/] },
  { subjectArea: "Safety Research", patterns: [/safety research|occupational safety|construction safety|risk mitigation|disaster management/] },
  { subjectArea: "Knowledge Management", patterns: [/knowledge management|knowledge transfer|knowledge discovery/] },

  { subjectArea: "Statistics and Probability", patterns: [/statistics|probability|statistical analysis|stochastic/] },
  { subjectArea: "Algebra and Number Theory", patterns: [/algebra|number theory|radix system/] },
  { subjectArea: "Applied Mathematics", patterns: [/applied mathematics|mathematical analys|mathematical method/] },
  { subjectArea: "Modeling and Simulation", patterns: [/mathematical model|modelling and simulation|modeling and simulation|simulation model/] },
  { subjectArea: "General Mathematics", patterns: [/journal of mathematics|general mathematics|mathematical science/] },
  { subjectArea: "Organic Chemistry", patterns: [/organic chemistry|organic synthesis|bioorganic/] },
  { subjectArea: "Inorganic Chemistry", patterns: [/inorganic chemistry|coordination chemistry/] },
  { subjectArea: "Physical and Theoretical Chemistry", patterns: [/physical chemistry|theoretical chemistry|computational chemistry|electrochemistry/] },
  { subjectArea: "General Chemistry", patterns: [/general chemistry|journal of chemistry\b|chemical science/] },
  { subjectArea: "General Physics and Astronomy", patterns: [/general physics|journal of physics|physical science/] },
  { subjectArea: "Astronomy and Astrophysics", patterns: [/astronom|astrophysic|space science/] },
  { subjectArea: "Nuclear and High Energy Physics", patterns: [/nuclear physics|high energy physics|particle physics/] },
  { subjectArea: "Acoustics and Ultrasonics", patterns: [/acoustic|ultrasonic|noise control|sound engineering/] },

  // Cross-disciplinary terms identified during the classifier's review pass.
  { subjectArea: "Electronics Engineering", patterns: [/dadda multiplier|mtcmos|cmos leakage|integrated circuit design/] },
  { subjectArea: "Animal Science and Zoology", patterns: [/fowl adenovirus|broiler|rhesus monkey|crocodile|wildlife science/] },
  { subjectArea: "Veterinary Sciences", patterns: [/veterinary science|crossbred cattle|animal medicine/] },
  { subjectArea: "Water Resource Engineering", patterns: [/river engineering|channel morphodynamic|sediment redistribution|groundwater science/] },
  { subjectArea: "Physical Therapy, Sports Therapy and Rehabilitation", patterns: [/resistance training versus aerobic|shoulder injuries|sarcopenia/] },
  { subjectArea: "Plant Science", patterns: [/antifungal efficacy of .* leaves|plant extract/] },
  { subjectArea: "Information Technology and Cyber Security", patterns: [/steganograph/] },
  { subjectArea: "Surfaces, Coatings and Films", patterns: [/adhesion science|adhesive configuration|microstructured surface/] },
  { subjectArea: "Demography", patterns: [/cross border mobility|population movement|migration and border/] },
  { subjectArea: "Cultural Studies", patterns: [/indology|cultural narrative|heritage identity/] },
  { subjectArea: "Aquatic Science", patterns: [/algal diversity|river ecology/] },
  { subjectArea: "Law", patterns: [/domestic violence.*legal|cyberlaw|cybercrime.*legal|legal challenge/] },
  { subjectArea: "Agronomy and Crop Science", patterns: [/safflower|fenugreek|seed production|seed morphometric|barley|crop genomics/] },
  { subjectArea: "Human Resource Management", patterns: [/digital onboarding|employee integration|talent acquisition/] },
  { subjectArea: "Fuel Technology", patterns: [/fuel integration|gas turbine fuel|emissions reduction.*fuel/] },
  { subjectArea: "Endocrinology, Diabetes and Metabolism", patterns: [/adipose tissue|obesity|metabolic health/] },
  { subjectArea: "Geology", patterns: [/volcanolog|volcanic gas|magma|eruption dynamic/] },
  { subjectArea: "Strategy and Management", patterns: [/corporate governance reform|institutional logic/] },
  { subjectArea: "Metals and Alloys", patterns: [/stainless steel degradation|corrosion science/] },
  { subjectArea: "Sports Science", patterns: [/sports biomechanics|athletic training and recovery|sports analytics|competitive state transition/] },
  { subjectArea: "Spectroscopy", patterns: [/icp oes|spectrometr|spectroscopic/] },
  { subjectArea: "Artificial Intelligence", patterns: [/ai driven|generic ai|evolutionary computation|generative model/] },
  { subjectArea: "Software Engineering", patterns: [/microservice|api governance|model driven engineering/] },
  { subjectArea: "Electronic, Optical and Magnetic Materials", patterns: [/amorphous silicon|crystal encapsulation|semiconductor material/] },
  { subjectArea: "General Dentistry", patterns: [/endodontic|sinus floor elevation|xenograft/] },
  { subjectArea: "Organizational Behavior and Human Resource Management", patterns: [/employee burnout|turnover intention|organizational psychology|occupational and organizational psychology/] },
  { subjectArea: "Information Systems", patterns: [/web semantic|semantic framework|information ecosystem/] },
  { subjectArea: "Genetics", patterns: [/quantitative trait locus|agricultural genomic|genome association/] },
];

const stopWords = new Set([
  "and", "the", "for", "with", "from", "into", "using", "based", "study", "review", "analysis",
  "international", "journal", "research", "development", "advanced", "application", "applications",
  "general", "miscellaneous", "science", "sciences", "technology", "technologies", "system", "systems",
  "method", "methods", "approach", "framework", "model", "models", "effect", "effects", "assessment",
]);

const clean = (value: string) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("en")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const stem = (token: string) => {
  if (token.length > 6 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 7 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 6 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
};

const tokenSet = (value: string) => new Set(clean(value).split(" ").filter(Boolean).map(stem));

async function main() {
  const [subjectAreas, manuscripts] = await Promise.all([
    prisma.$queryRawUnsafe<SubjectArea[]>(`SELECT subject_area_id id,major_subject majorSubject,
      classification_name classificationName,subject_area subjectArea
      FROM ijpass_journals.subject_area_tbl ORDER BY subject_area_id`),
    prisma.$queryRawUnsafe<Manuscript[]>(`SELECT manuscript.manuscript_id id,
      manuscript.article_title title,manuscript.keywords,
      source.journal_title journalTitle
      FROM ijpass_journals.manuscript_tbl manuscript
      INNER JOIN ijpass_journals.sourcedata_tbl source
        ON source.source_data_id=manuscript.journal_id
      WHERE manuscript.subject_area_id IS NULL
      ORDER BY manuscript.manuscript_id`),
  ]);

  const subjectsByName = new Map(subjectAreas.map((subject) => [subject.subjectArea.toLocaleLowerCase("en"), subject]));
  for (const rule of rules) {
    if (!subjectsByName.has(rule.subjectArea.toLocaleLowerCase("en"))) {
      throw new Error(`Classifier rule references an unknown subject area: ${rule.subjectArea}`);
    }
  }

  const documentFrequency = new Map<string, number>();
  for (const subject of subjectAreas) {
    const tokens = new Set([...tokenSet(subject.subjectArea), ...tokenSet(subject.classificationName)]);
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }

  const assignments = manuscripts.map((manuscript) => {
    const articleText = clean(`${manuscript.title} ${manuscript.keywords}`);
    const journalText = clean(manuscript.journalTitle);
    const titleTokens = tokenSet(manuscript.title);
    const keywordTokens = tokenSet(manuscript.keywords);
    const journalTokens = tokenSet(manuscript.journalTitle);
    const scores = new Map<number, { subject: SubjectArea; score: number; ruleHits: string[] }>();

    for (const subject of subjectAreas) {
      let score = 0;
      const subjectPhrase = clean(subject.subjectArea);
      const classificationPhrase = clean(subject.classificationName);
      if (subjectPhrase.length > 3 && articleText.includes(subjectPhrase)) score += 90;
      if (subjectPhrase.length > 3 && journalText.includes(subjectPhrase)) score += 70;
      if (classificationPhrase.length > 4 && articleText.includes(classificationPhrase)) score += 34;
      if (classificationPhrase.length > 4 && journalText.includes(classificationPhrase)) score += 28;
      const subjectTokens = [...tokenSet(subject.subjectArea)].filter((token) => !stopWords.has(token));
      const classificationTokens = [...tokenSet(subject.classificationName)].filter((token) => !stopWords.has(token));
      for (const token of subjectTokens) {
        const rarity = Math.max(1, Math.log2((subjectAreas.length + 1) / (documentFrequency.get(token) || 1)));
        if (titleTokens.has(token)) score += 8 * rarity;
        if (keywordTokens.has(token)) score += 10 * rarity;
        if (journalTokens.has(token)) score += 7 * rarity;
      }
      for (const token of classificationTokens) {
        const rarity = Math.max(1, Math.log2((subjectAreas.length + 1) / (documentFrequency.get(token) || 1)));
        if (titleTokens.has(token)) score += 2 * rarity;
        if (keywordTokens.has(token)) score += 2.5 * rarity;
        if (journalTokens.has(token)) score += 2 * rarity;
      }
      scores.set(Number(subject.id), { subject, score, ruleHits: [] });
    }

    for (const rule of rules) {
      const subject = subjectsByName.get(rule.subjectArea.toLocaleLowerCase("en"))!;
      const candidate = scores.get(Number(subject.id))!;
      for (const pattern of rule.patterns) {
        if (pattern.test(articleText)) {
          candidate.score += 150;
          candidate.ruleHits.push(`article:${pattern.source}`);
        }
        pattern.lastIndex = 0;
        if (pattern.test(journalText)) {
          candidate.score += 100;
          candidate.ruleHits.push(`resource:${pattern.source}`);
        }
        pattern.lastIndex = 0;
      }
    }

    const ranked = [...scores.values()].sort((left, right) => right.score - left.score || Number(left.subject.id - right.subject.id));
    let selected = ranked[0];
    let method = selected.ruleHits.length ? "rule+taxonomy" : "taxonomy";
    if (!selected || selected.score <= 0) {
      const fallbackName = /computer|software|data|digital/i.test(manuscript.journalTitle)
        ? "General Computer Science"
        : /engineer|technolog/i.test(manuscript.journalTitle)
          ? "General Engineering and Technology"
          : /medical|medicine|health|clinical/i.test(manuscript.journalTitle)
            ? "General Medicine"
            : /business|management|commerce/i.test(manuscript.journalTitle)
              ? "General Business, Management and Accounting"
              : "Multidisciplinary :Social Sciences and Humanities";
      const fallback = subjectsByName.get(fallbackName.toLocaleLowerCase("en"));
      if (!fallback) throw new Error(`Fallback subject area is missing: ${fallbackName}`);
      selected = { subject: fallback, score: 1, ruleHits: [] };
      method = "fallback";
    }
    const margin = selected.score - (ranked.find((candidate) => candidate.subject.id !== selected.subject.id)?.score || 0);
    const confidence = selected.ruleHits.length || selected.score >= 120 || margin >= 35
      ? "high"
      : selected.score >= 30 || margin >= 12
        ? "medium"
        : "low";
    return {
      manuscriptId: Number(manuscript.id),
      subjectAreaId: Number(selected.subject.id),
      subjectArea: selected.subject.subjectArea,
      score: Number(selected.score.toFixed(2)),
      margin: Number(margin.toFixed(2)),
      confidence,
      method,
      title: manuscript.title,
      journalTitle: manuscript.journalTitle,
    };
  });

  const confidenceCounts = assignments.reduce<Record<string, number>>((counts, assignment) => {
    counts[assignment.confidence] = (counts[assignment.confidence] || 0) + 1;
    return counts;
  }, {});
  const subjectCounts = [...assignments.reduce<Map<string, number>>((counts, assignment) => {
    counts.set(assignment.subjectArea, (counts.get(assignment.subjectArea) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort((left, right) => right[1] - left[1]);

  console.log(`Unassigned manuscripts found: ${assignments.length}.`);
  console.log(`Confidence: high ${confidenceCounts.high || 0}, medium ${confidenceCounts.medium || 0}, low ${confidenceCounts.low || 0}.`);
  console.log("Most-used subject areas:");
  for (const [subjectArea, count] of subjectCounts.slice(0, 20)) console.log(`  ${count}\t${subjectArea}`);
  const review = assignments.filter((assignment) => assignment.confidence !== "high").slice(0, 100);
  if (review.length) {
    console.log("Review sample (medium/low confidence):");
    for (const assignment of review) {
      console.log(`  ${assignment.manuscriptId}\t${assignment.confidence}\t${assignment.score}\t${assignment.subjectArea}\t${assignment.title}\t[${assignment.journalTitle}]`);
    }
  }

  if (!applyChanges) {
    console.log("Preview only. Run with --apply to save these assignments.");
    return;
  }

  for (let index = 0; index < assignments.length; index += 100) {
    const batch = assignments.slice(index, index + 100);
    await prisma.$transaction(batch.map((assignment) => prisma.$executeRawUnsafe(
      `UPDATE ijpass_journals.manuscript_tbl
       SET subject_area_id=?
       WHERE manuscript_id=? AND subject_area_id IS NULL`,
      assignment.subjectAreaId,
      assignment.manuscriptId,
    )));
  }
  console.log(`Saved one subject area for ${assignments.length} manuscripts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
