// Anchor tasks: real O*NET 31.0 task statements with known expected outcomes.
// The pilot passes when at least 12 of 15 HIGH anchors rank in the top quarter of the pilot
// and at least 12 of 15 LOW anchors rank in the bottom quarter.
// `task` is the O*NET text at selection time; src/jev-score.js checks it still matches the DB.

export const HIGH_ANCHORS = [
  { task_id: 21417, onet: '13-1031.00', why: 'insurance claim coverage review', task: 'Examine claims forms and other records to determine insurance coverage.' },
  { task_id: 2542, onet: '43-3061.00', why: 'invoice vs purchase order check', task: "Compare suppliers' bills with bids and purchase orders to verify accuracy." },
  { task_id: 2509, onet: '43-3031.00', why: 'invoice matching', task: 'Match order forms with invoices, and record the necessary information.' },
  { task_id: 18868, onet: '13-1071.00', why: 'resume screening against job requirements', task: 'Review employment applications and job orders to match applicants with job requirements.' },
  { task_id: 2699, onet: '43-4161.00', why: 'resume screening', task: 'Select applicants meeting specified job requirements and refer them to hiring personnel.' },
  { task_id: 15643, onet: '11-9199.02', why: 'content review against a policy', task: 'Review communications such as securities sales advertising to ensure there are no violations of standards or regulations.' },
  { task_id: 18051, onet: '13-1041.07', why: 'content review against regulations', task: 'Review product promotional materials, labeling, batch records, specification sheets, or test methods for compliance with applicable regulations and policies.' },
  { task_id: 16045, onet: '13-2099.04', why: 'flagging suspicious transactions / fraud triage', task: 'Review reports of suspected fraud to determine need for further investigation.' },
  { task_id: 5296, onet: '13-2081.00', why: 'rule-based document review with money attached', task: 'Review filed tax returns to determine whether claimed tax credits and deductions are allowed by law.' },
  { task_id: 23301, onet: '43-4041.00', why: 'approve/deny against predetermined standards', task: "Evaluate customers' computerized credit records and payment histories to decide whether to approve new credit, based on predetermined standards." },
  { task_id: 11291, onet: '43-4131.00', why: 'document verification', task: 'Verify and examine information and accuracy of loan application and closing documents.' },
  { task_id: 9736, onet: '43-4061.00', why: 'eligibility determination', task: 'Compile, record, and evaluate personal and financial data to verify completeness and accuracy, and to determine eligibility status.' },
  { task_id: 22881, onet: '29-2072.00', why: 'classification into a standard code set', task: 'Identify, compile, abstract, and code patient data, using standard classification systems.' },
  { task_id: 23267, onet: '43-4031.00', why: 'application approve/deny', task: 'Evaluate information on applications to verify completeness and accuracy and to determine whether applicants are qualified to obtain desired licenses.' },
  { task_id: 9236, onet: '23-2093.00', why: 'document acceptance check', task: 'Verify accuracy and completeness of land-related documents accepted for registration, preparing rejection notices when documents are not acceptable.' },
];

export const LOW_ANCHORS = [
  { task_id: 22754, onet: '29-1242.00', why: 'performing surgery', task: "Operate on patient's musculoskeletal system to correct deformities, repair injuries, prevent and treat diseases, or improve or restore patient's functions." },
  { task_id: 13505, onet: '47-2081.00', why: 'installing drywall', task: 'Fit and fasten wallboard or drywall into position on wood or metal frameworks, using glue, nails, or screws.' },
  { task_id: 10641, onet: '53-3032.00', why: 'driving trucks', task: 'Drive trucks with capacities greater than 13 tons, including tractor-trailer combinations, to transport and deliver products, livestock, or other materials.' },
  { task_id: 2170, onet: '35-2014.00', why: 'cooking', task: 'Season and cook food according to recipes or personal judgment and experience.' },
  { task_id: 6540, onet: '25-2021.00', why: 'teaching a live class', task: 'Instruct students individually and in groups, using teaching methods such as lectures, discussions, and demonstrations.' },
  { task_id: 4771, onet: '47-2021.00', why: 'bricklaying', task: 'Fasten or fuse brick or other building material to structure with wire clamps, anchor holes, torch, or cement.' },
  { task_id: 13579, onet: '47-2181.00', why: 'roofing', task: 'Install, repair, or replace single-ply roofing systems, using waterproof sheet materials such as modified plastics, elastomeric, or other asphaltic compositions.' },
  { task_id: 7880, onet: '31-9011.00', why: 'massage', task: 'Massage and knead muscles and soft tissues of the body to provide treatment for medical conditions, injuries, or wellness maintenance.' },
  { task_id: 636, onet: '39-5012.00', why: 'cutting hair', task: "Cut, trim and shape hair or hairpieces, based on customers' instructions, hair type, and facial features, using clippers, scissors, trimmers and razors." },
  { task_id: 416, onet: '29-1292.00', why: 'cleaning teeth', task: 'Clean calcareous deposits, accretions, and stains from teeth and beneath margins of gums, using dental instruments.' },
  { task_id: 22961, onet: '33-2011.00', why: 'firefighting rescue', task: 'Rescue survivors from burning buildings, accident sites, and water hazards.' },
  { task_id: 23459, onet: '47-2152.00', why: 'plumbing', task: 'Cut, thread, or hammer pipes to specifications, using tools such as saws, cutting torches, pipe threaders, or pipe benders.' },
  { task_id: 9589, onet: '37-3011.00', why: 'landscaping', task: 'Mow or edge lawns, using power mowers or edgers.' },
  { task_id: 23582, onet: '51-4121.00', why: 'welding', task: 'Weld components in flat, vertical, or overhead positions.' },
  { task_id: 9540, onet: '37-2011.00', why: 'cleaning floors', task: 'Clean building floors by sweeping, mopping, scrubbing, or vacuuming.' },
];

export const ANCHOR_IDS = [...HIGH_ANCHORS, ...LOW_ANCHORS].map((a) => a.task_id);
