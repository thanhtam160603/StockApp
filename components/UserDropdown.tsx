"use client"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import { LogOut } from "lucide-react";
import NavItems from "./NavItems";
import { signOut } from "@/lib/actions/auth.actions";

const UserDropdown = ({ user, initialStocks }: { user: User; initialStocks: StockWithWatchlistStatus[] }) => {
    const router = useRouter();

    const handSignOut = async () => {
        await signOut();
        router.push("/sign-in");
    }
    
  return (
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-3 text-gray-4 hover:text-yellow-500">
                  <Avatar className="w-8 h-8">
                        <AvatarImage
                          src="https://github.com/shadcn.png"
                        />
                        <AvatarFallback className="bg-yellow-500 text-yellow-900 text-sm font-bold">
                          {user.name[0]}
                       </AvatarFallback>
                   </Avatar>
                   <div className="hidden sm:flex flex-col items-start">
                        <span className="text-base font-medium text-gray-400">
                            {user.name}
                        </span>
                  </div>
              </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64 bg-gray-800 text-gray-400">
              <DropdownMenuLabel>
                  <div className="flex relative items-center gap-3 py-2">
                      <Avatar className="w-10 h-10">
                          <AvatarImage
                              src="https://github.com/shadcn.png"
                          />
                          <AvatarFallback className="bg-yellow-500 text-yellow-900 text-sm font-bold">
                              {user.name[0]}
                          </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                          <span className="text-base font-medium text-gray-400">
                              {user.name}
                          </span>
                          <span className="text-sm text-gray-500">
                              {user.email}
                          </span>
                      </div>
                  </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-gray-600" />
              <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handSignOut} className="text-gray-100 text-md font-medium focus:bg-transparent focus:text-yellow-500 transition-colors cursor-pointer ">
                      <LogOut className="w-4 h-4 mr-2 hidden sm:block" />
                      Sign Out
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="hidden sm:block bg-gray-600" />

                  <nav className="sm:hidden">
                      <NavItems initialStocks={initialStocks} />
                  </nav>
              </DropdownMenuGroup>
              
          </DropdownMenuContent>
      </DropdownMenu>
  )
}

export default UserDropdown
