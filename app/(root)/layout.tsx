import Header from "@/components/Header";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from '@/components/ui/skeleton'

export const instant = false;
const Layout = async ({ children }: { children: React.ReactNode }) => {
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session?.user) redirect('/sign-in');
    
    const user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
    }
    return (
        <Suspense fallback={<Skeleton />}>
            <main className="min-h-screen text-gray-400">
                <Header user={user} />
                {children}
            </main>
        </Suspense>
    )
}

export default Layout;