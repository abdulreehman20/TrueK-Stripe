import {
  FaFacebook,
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaXRay,
} from "react-icons/fa";

export const socialLinks = [
  {
    icon: FaGithub,
    href: "https://TrueKinspection.com",
    label: "GitHub",
  },
  {
    icon: FaLinkedin,
    href: "https://TrueKinspection.com",
    label: "LinkedIn",
  },
  {
    icon: FaFacebook,
    href: "https://TrueKinspection.com",
    label: "Facebook",
  },
  {
    icon: FaInstagram,
    href: "https://TrueKinspection.com",
    label: "Instagram",
  },
  { icon: FaXRay, href: "https://TrueKinspection.com", label: "Twitter" },
];

export const pricing = [
  {
    id: "10201",
    plan: "Our Plan",
    price: "$79",
    features: [
      "1 Vehicle Report",
      "Vehicle Specification",
      "DMV Title History",
      "Safety Recall Status",
      "Online Listing History",
      "Junk & Salvage Information",
      "Accident Information",
    ],
  },
];

/**
 * Report price shown on the site. The Stripe Payment Link amount is configured
 * in the Stripe Dashboard (keep them in sync).
 */
export const REPORT_PRICE_DISPLAY = "$79";
export const REPORT_PRICE_CENTS = 7900;
export const REPORT_CURRENCY = "usd";
