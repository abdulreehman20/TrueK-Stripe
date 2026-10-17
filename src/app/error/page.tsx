import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

type ErrorPageProps = {
  searchParams: Promise<{ message?: string }>;
};

export default async function PaymentErrorPage({ searchParams }: ErrorPageProps) {
  const params = await searchParams;
  const message =
    typeof params.message === "string" && params.message.trim()
      ? params.message.trim()
      : "Something went wrong while completing your purchase. If you were charged, contact support and we will send your report.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-16">
      <div className="max-w-lg w-full rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-8 w-8 text-custom_red" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Unable to complete order
        </h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="mailto:truekinspection@gmail.com">
            <Button className="bg-custom_red hover:bg-red-700 text-white w-full sm:w-auto">
              Contact Support
            </Button>
          </a>
          <Link href="/">
            <Button
              variant="outline"
              className="border-gray-300 text-gray-700 w-full sm:w-auto"
            >
              Return Home
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
