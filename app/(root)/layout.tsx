import Header from "@/components/Header";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from '@/components/ui/skeleton'

// Suspense phải nằm bên ngoài component đọc headers/session.
const AuthenticatedLayout = async ({ children }: { children: React.ReactNode }) => {
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
        <main className="min-h-screen text-gray-400">
            <Header user={user} />
            {children}
        </main>
    )
}

const Layout = ({ children }: { children: React.ReactNode }) => (
    <Suspense fallback={<Skeleton className="min-h-screen w-full" />}>
        <AuthenticatedLayout>{children}</AuthenticatedLayout>
    </Suspense>
);

export default Layout;
